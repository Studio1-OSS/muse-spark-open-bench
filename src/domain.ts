import { createHash, randomUUID } from 'node:crypto';
export const id = () => randomUUID();
export const hash = (value: unknown) =>
  createHash('sha256')
    .update(
      typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value),
    )
    .digest('hex');
export const now = () => new Date().toISOString();
export type Outcome =
  | 'queued'
  | 'running'
  | 'pass'
  | 'fail'
  | 'timeout'
  | 'budget_exceeded'
  | 'infrastructure_error'
  | 'cancelled'
  | 'interrupted';
export interface Limits {
  maxSteps: number;
  taskSeconds: number;
  maxOutputTokens: number;
  taskCost: number;
  batchCost: number;
}
export interface Benchmark {
  id: string;
  name: string;
  suiteHash: string;
  taskIds: string[];
  createdAt: string;
  state: 'running' | 'paused' | 'cancelled' | 'complete';
  limits: Limits;
  configHash: string;
}
export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
  [key: string]: unknown;
}
export interface Price {
  at: string;
  model: string;
  currency: 'USD';
  unit: 'token';
  prompt?: string;
  completion?: string;
  cache?: string;
  raw: unknown;
}
export interface RequestRecord {
  id: string;
  runId: string;
  startedAt: string;
  finishedAt?: string;
  status: number | null;
  usage?: Usage;
  cost: string | null;
  complete: boolean;
  error?: string;
  inputHash: string;
  requestSettings: Record<string, unknown>;
}
export interface Run {
  id: string;
  benchmarkId: string;
  taskId: string;
  ordinal: number;
  primary: boolean;
  outcome: Outcome;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  reason?: string;
  model: string;
  promptHash: string;
  configHash: string;
  limits: Limits;
  summary?: string;
  price?: Price;
}
export interface TraceEvent {
  runId: string;
  sequence: number;
  at: string;
  type: string;
  data: Record<string, unknown>;
}
export interface Artifact {
  id: string;
  runId: string;
  name: string;
  mime: string;
  digest: string;
  bytes: number;
  path: string;
  at: string;
}
