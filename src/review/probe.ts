import { Agent } from '@mastra/core/agent';
import { config } from '../config.js';
import { hash, id, now, type Run } from '../domain.js';
import { catalog, provider } from '../provider.js';
import type { Store } from '../store.js';
import type { ReviewCase } from './cases.js';

// Memory probe: no code, no diff, no tools. Checks whether Muse already "knows" a PR's fate from training.
export const PROBE_PROMPT = `Answer from memory only. You have no tools and no access to the code. If you do not know, reply with exactly UNKNOWN.`;

export interface ProbeRecord {
  id: string;
  caseId: string;
  question: string;
  answer: string;
  unknown: boolean;
  at: string;
  error?: string;
}

export async function probeCase(store: Store, benchmarkId: string, c: ReviewCase, ordinal: number) {
  const limits = { ...config.limits, maxSteps: 1 };
  const run: Run = {
    id: id(),
    benchmarkId,
    taskId: `probe:${c.id}`,
    ordinal,
    primary: true,
    outcome: 'running',
    createdAt: now(),
    startedAt: now(),
    model: config.model,
    promptHash: hash(PROBE_PROMPT),
    configHash: hash({ prompt: PROBE_PROMPT, model: config.model }),
    limits,
  };
  store.put('run', run);
  const controller = new AbortController();
  const question = `Repository: ${c.repo}\nCommit ${c.sha}: "${c.subject}" (merged ${c.mergedAt?.slice(0, 10) ?? 'unknown date'}).\n\nWas this change later reverted, or did a later commit fix a bug that it introduced? If you know, describe that bug in one or two sentences. If you do not know, reply with exactly UNKNOWN.`;
  try {
    run.price = await catalog(controller.signal);
    const agent = new Agent({
      id: `muse-probe-${run.id}`,
      name: 'Muse memory probe',
      instructions: PROBE_PROMPT,
      model: provider(store, run, run.price, controller.signal),
      maxRetries: 0,
    });
    const result = await agent.generate([{ role: 'user', content: question }], {
      maxSteps: 1,
      abortSignal: controller.signal,
      modelSettings: { maxOutputTokens: limits.maxOutputTokens, maxRetries: 0 },
    });
    const answer = result.text.trim();
    store.updateRun(run.id, { outcome: 'pass', summary: answer, finishedAt: now() });
    return store.put<ProbeRecord>('probe-result', {
      id: run.id,
      caseId: c.id,
      question,
      answer,
      unknown: /^UNKNOWN\.?$/i.test(answer),
      at: now(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.updateRun(run.id, {
      outcome: 'infrastructure_error',
      reason: message,
      finishedAt: now(),
    });
    return store.put<ProbeRecord>('probe-result', {
      id: run.id,
      caseId: c.id,
      question,
      answer: '',
      unknown: false,
      at: now(),
      error: message,
    });
  }
}
