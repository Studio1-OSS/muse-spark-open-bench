// PR Review Bench CLI: run reviews, combine runs into results/, and run the memory probe.
// Usage: npm run bench -- run [CASE_IDS...] | export BENCHMARK_ID... | probe
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { Store } from '../store.js';
import { id, now, type Benchmark, type Run, type RequestRecord } from '../domain.js';
import { totals } from '../accounting.js';
import { loadSelection } from './cases.js';
import { reviewCase, REVIEW_PROMPT, type ReviewRecord } from './runner.js';
import { probeCase, PROBE_PROMPT, type ProbeRecord } from './probe.js';
import { hash } from '../domain.js';

const [action, ...args] = process.argv.slice(2);
const store = new Store();
const selection = loadSelection();

// Combines one or more benchmark runs (same prompt and config) into results/.
function exportResults(benchmarkIds: string[]) {
  const runs = store.all<Run>('run').filter((r) => benchmarkIds.includes(r.benchmarkId));
  const hashes = new Set(benchmarkIds.map((b) => store.get<Benchmark>('benchmark', b)?.configHash));
  if (hashes.size !== 1)
    throw new Error('Benchmarks use different configurations and cannot be combined');
  const ids = new Set(runs.filter((r) => r.outcome !== 'interrupted').map((r) => r.id));
  const reviews = store.all<ReviewRecord>('review-result').filter((r) => ids.has(r.id));
  const requests = store.all<RequestRecord>('request').filter((r) => ids.has(r.runId));
  const out = join(config.root, 'results');
  mkdirSync(out, { recursive: true });
  // One completed review per case.
  const primary = runs.filter((r) => r.outcome !== 'interrupted');
  const seen = new Set<string>();
  for (const r of primary) {
    if (seen.has(r.taskId)) throw new Error(`More than one completed attempt for ${r.taskId}`);
    seen.add(r.taskId);
  }
  const row = (r: Run) => {
    const t = totals(requests.filter((q) => q.runId === r.id));
    const tools = store.events(r.id).filter((e) => e.type === 'tool.started').length;
    const seconds =
      r.startedAt && r.finishedAt
        ? (Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000
        : null;
    return {
      runId: r.id,
      caseId: r.taskId,
      outcome: r.outcome === 'pass' ? 'completed' : r.outcome,
      seconds,
      tools,
      ...t,
    };
  };
  const perRun = primary.map(row);
  writeFileSync(
    join(out, 'reviews.jsonl'),
    reviews.map((r) => JSON.stringify(r)).join('\n') + '\n',
  );
  writeFileSync(
    join(out, 'requests.jsonl'),
    requests.map((r) => JSON.stringify(r)).join('\n') + '\n',
  );
  writeFileSync(join(out, 'runs.json'), JSON.stringify(perRun, null, 2));
  writeFileSync(join(out, 'cases.json'), JSON.stringify(selection, null, 2));
  writeFileSync(
    join(out, 'usage.json'),
    JSON.stringify(
      {
        benchmarkIds,
        benchmarkId: benchmarkIds[0],
        model: config.model,
        promptHash: hash(REVIEW_PROMPT),
        attempts: primary.length,
        ...totals(requests),
      },
      null,
      2,
    ),
  );
  return out;
}

try {
  if (action === 'run') {
    const cases = args.length
      ? selection.cases.filter((c) => args.includes(c.id))
      : selection.cases;
    if (!cases.length) throw new Error('No matching cases');
    const benchmark: Benchmark = {
      id: id(),
      name: args.length ? 'PR review (subset)' : `PR review ${selection.version}`,
      suiteHash: hash(selection),
      taskIds: cases.map((c) => c.id),
      createdAt: now(),
      state: 'running',
      limits: config.limits,
      configHash: hash({ prompt: REVIEW_PROMPT, model: config.model }),
    };
    store.put('benchmark', benchmark);
    console.log(`Benchmark ${benchmark.id}: ${cases.length} cases`);
    for (const [i, c] of cases.entries()) {
      const spent = totals(
        store
          .all<RequestRecord>('request')
          .filter((r) => store.get<Run>('run', r.runId)?.benchmarkId === benchmark.id),
      );
      if (Number(spent.cost) >= config.limits.batchCost) {
        console.log('Batch cost limit reached; remaining cases not run.');
        break;
      }
      const result = await reviewCase(store, benchmark.id, c, i);
      const t = totals(store.requests(result.id));
      console.log(
        `[${i + 1}/${cases.length}] ${c.id}: ${result.ok ? result.review!.verdict + ` (${result.review!.findings.length} findings)` : 'ERROR ' + result.error}  $${t.cost} calls=${t.calls}`,
      );
    }
    store.put('benchmark', { ...benchmark, state: 'complete' });
    if (args.length)
      console.log(
        `Subset run ${benchmark.id} saved. Combine it with: npm run bench -- export <ids...> ${benchmark.id}`,
      );
    else console.log(`Saved ${exportResults([benchmark.id])}`);
  } else if (action === 'export') {
    if (!args.length) throw new Error('Usage: npm run bench -- export BENCHMARK_ID...');
    console.log(exportResults(args));
  } else if (action === 'probe') {
    const cases = selection.cases.filter(
      (c) => c.kind === 'bug' && (!args.length || args.includes(c.id)),
    );
    const benchmark: Benchmark = {
      id: id(),
      name: 'Memory probe',
      suiteHash: hash(selection),
      taskIds: cases.map((c) => c.id),
      createdAt: now(),
      state: 'running',
      limits: config.limits,
      configHash: hash({ prompt: PROBE_PROMPT, model: config.model }),
    };
    store.put('benchmark', benchmark);
    const records: ProbeRecord[] = [];
    for (const [i, c] of cases.entries()) {
      const r = await probeCase(store, benchmark.id, c, i);
      records.push(r);
      console.log(
        `[${i + 1}/${cases.length}] ${c.id}: ${r.error ? 'ERROR ' + r.error : r.unknown ? 'UNKNOWN' : r.answer.slice(0, 120).replace(/\n/g, ' ')}`,
      );
    }
    store.put('benchmark', { ...benchmark, state: 'complete' });
    // The latest completed answer per case.
    const probeRuns = new Set(
      store
        .all<Benchmark>('benchmark')
        .filter((b) => b.name === 'Memory probe')
        .map((b) => b.id),
    );
    const latest = new Map<string, ProbeRecord>();
    for (const r of store.all<ProbeRecord>('probe-result'))
      if (!r.error && probeRuns.has(store.get<Run>('run', r.id)?.benchmarkId ?? ''))
        latest.set(r.caseId, r);
    const all = [...latest.values()];
    const ids = new Set(all.map((r) => r.id));
    const requests = store.all<RequestRecord>('request').filter((r) => ids.has(r.runId));
    const out = join(config.root, 'results');
    writeFileSync(join(out, 'probe.jsonl'), all.map((r) => JSON.stringify(r)).join('\n') + '\n');
    writeFileSync(
      join(out, 'probe-usage.json'),
      JSON.stringify(
        {
          prompt: PROBE_PROMPT,
          cases: all.length,
          ...totals(requests),
        },
        null,
        2,
      ),
    );
    console.log(`Saved probe answers for ${all.length} cases`);
  } else console.log('Usage: npm run bench -- run [CASE_IDS...] | export BENCHMARK_ID... | probe');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  store.close();
}
