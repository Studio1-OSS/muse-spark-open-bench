// Checks the real, saved PR Review Bench results. No fixtures or mocks: every assertion reads results/.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Decimal from 'decimal.js';

const dir = 'results';
const json = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const jsonl = (f: string) =>
  readFileSync(join(dir, f), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
const ready = existsSync(join(dir, 'summary.json'));

describe.runIf(ready)('PR Review Bench saved results', () => {
  const cases = json('cases.json').cases as { id: string; kind: string }[];
  const grades = JSON.parse(readFileSync('benchmarks/grades.json', 'utf8')).cases;
  const reviews = jsonl('reviews.jsonl') as {
    caseId: string;
    ok: boolean;
    review: { verdict: string; findings: { severity: string }[] };
  }[];
  const runs = json('runs.json') as { caseId: string; cost: string }[];
  const summary = json('summary.json');

  it('has exactly one review, run and grade for every case', () => {
    for (const c of cases) {
      expect(
        reviews.filter((r) => r.caseId === c.id),
        c.id,
      ).toHaveLength(1);
      expect(
        runs.filter((r) => r.caseId === c.id),
        c.id,
      ).toHaveLength(1);
      expect(grades[c.id], c.id).toBeDefined();
    }
    expect(
      Object.keys(grades)
        .filter((k) => !k.startsWith('visual-'))
        .sort(),
    ).toEqual(cases.map((c) => c.id).sort());
  });

  it('points every caught or partial grade at a finding that exists', () => {
    for (const c of cases.filter((c) => c.kind === 'bug')) {
      const g = grades[c.id];
      expect(['caught', 'partial', 'missed']).toContain(g.grade);
      if (g.grade === 'missed') continue;
      const findings = reviews.find((r) => r.caseId === c.id)!.review.findings;
      expect(g.match, c.id).toBeGreaterThanOrEqual(0);
      expect(g.match, c.id).toBeLessThan(findings.length);
    }
  });

  it('summary counts match the grades', () => {
    const bugs = cases.filter((c) => c.kind === 'bug');
    const n = (grade: string) => bugs.filter((c) => grades[c.id].grade === grade).length;
    expect(summary.bugCases).toBe(bugs.length);
    expect(summary.controlCases).toBe(cases.length - bugs.length);
    expect(summary.caught).toBe(n('caught'));
    expect(summary.partial).toBe(n('partial'));
    expect(summary.missed).toBe(n('missed'));
    expect(summary.caught + summary.partial + summary.missed).toBe(bugs.length);
    expect(summary.strictCaught).toBeLessThanOrEqual(summary.caught);
  });

  it('costs add up from the per-request ledger and every request reported usage', () => {
    const requests = jsonl('requests.jsonl') as {
      runId: string;
      cost: string;
      complete: boolean;
    }[];
    expect(requests.every((r) => r.complete)).toBe(true);
    const ledger = requests.reduce((s, r) => s.add(r.cost), new Decimal(0));
    expect(ledger.toFixed(8)).toBe(new Decimal(json('usage.json').cost).toFixed(8));
    const perRun = runs.reduce((s, r) => s.add(r.cost), new Decimal(0));
    expect(perRun.toFixed(8)).toBe(ledger.toFixed(8));
  });

  it('labels a catch reproduced only when it fails on merged and passes on the fix', () => {
    const manifest = JSON.parse(readFileSync('benchmarks/repro/manifest.json', 'utf8'));
    const logs = readdirSync(join(dir, 'repro')).map((f) => json(join('repro', f)));
    for (const log of logs) {
      if (log.kind === 'control') {
        // A clean-PR finding has no fix commit: it is confirmed when the check fails on the merged commit.
        expect(log.reproduced).toBe(false);
        expect(log.confirmed).toBe(log.runs.merged.exitCode !== 0);
        expect(grades[log.case].confirmed ?? 0).toBe(log.confirmed ? 1 : 0);
        continue;
      }
      expect(log.reproduced).toBe(log.runs.merged.exitCode !== 0 && log.runs.fix.exitCode === 0);
      expect(log.introduced).toBe(log.reproduced && log.runs.parent.exitCode === 0);
      expect(existsSync(log.script), log.script).toBe(true);
    }
    // Every caught bug is either reproduced or listed with a reason it was not executed.
    for (const c of cases.filter((c) => grades[c.id].grade === 'caught')) {
      const reproduced = logs.some((l) => l.case === c.id && l.reproduced);
      const excused = manifest.notExecuted.some((n: { case: string }) => n.case === c.id);
      expect(reproduced || excused, c.id).toBe(true);
    }
    expect(summary.reproduced).toBe(
      logs.filter((l) => l.reproduced && grades[l.case]?.grade === 'caught').length,
    );
  });

  it('asked the memory probe about every bug PR', () => {
    const probes = jsonl('probe.jsonl') as { caseId: string; error?: string; unknown: boolean }[];
    for (const c of cases.filter((c) => c.kind === 'bug'))
      expect(
        probes.some((p) => p.caseId === c.id && !p.error),
        c.id,
      ).toBe(true);
    expect(summary.probe.answered).toBe(cases.filter((c) => c.kind === 'bug').length);
  });

  it('publishes a site that embeds the same summary', () => {
    const html = readFileSync('site/index.html', 'utf8');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain(`"caught":${summary.caught}`);
    for (const f of ['reviews.jsonl', 'requests.jsonl', 'grades.json', 'summary.json', 'RUBRIC.md'])
      expect(existsSync(join('site/data', f)), f).toBe(true);
  });

  describe.runIf(existsSync(join(dir, 'visual', 'runs.json')))('visual track', () => {
    const vcases = json('visual/cases.json').cases as { id: string; kind: string }[];
    const vreviews = jsonl('visual/reviews.jsonl') as {
      caseId: string;
      review: { findings: unknown[] };
    }[];
    const vruns = json('visual/runs.json') as { caseId: string; cost: string }[];

    it('has one review, run, grade and at least one screenshot per visual case', () => {
      expect(vcases.length).toBe(10);
      for (const c of vcases) {
        expect(c.kind).toBe('visual');
        expect(
          vreviews.filter((r) => r.caseId === c.id),
          c.id,
        ).toHaveLength(1);
        expect(
          vruns.filter((r) => r.caseId === c.id),
          c.id,
        ).toHaveLength(1);
        expect(grades[c.id], c.id).toBeDefined();
        expect(readdirSync(join('benchmarks', 'visual', c.id)).length, c.id).toBeGreaterThan(0);
      }
    });

    it('points every caught or partial visual grade at a finding that exists', () => {
      for (const c of vcases) {
        const g = grades[c.id];
        if (g.grade === 'missed') continue;
        const n = vreviews.find((r) => r.caseId === c.id)!.review.findings.length;
        expect(g.match, c.id).toBeGreaterThanOrEqual(0);
        expect(g.match, c.id).toBeLessThan(n);
      }
    });

    it('summary and costs match the visual records', () => {
      const v = summary.visual;
      const n = (k: string) => vcases.filter((c) => grades[c.id].grade === k).length;
      expect([v.caught, v.partial, v.missed]).toEqual([n('caught'), n('partial'), n('missed')]);
      const requests = jsonl('visual/requests.jsonl') as { cost: string; complete: boolean }[];
      expect(requests.every((r) => r.complete)).toBe(true);
      const ledger = requests.reduce((s, r) => s.add(r.cost), new Decimal(0));
      expect(ledger.toFixed(8)).toBe(new Decimal(json('visual/usage.json').cost).toFixed(8));
      expect(vruns.reduce((s, r) => s.add(r.cost), new Decimal(0)).toFixed(8)).toBe(
        ledger.toFixed(8),
      );
    });
  });
});
