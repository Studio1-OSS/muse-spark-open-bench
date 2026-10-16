import 'dotenv/config';
import { resolve } from 'node:path';
import type { Limits } from './domain.js';
const positive = (key: string, fallback: number) => {
  const n = Number(process.env[key] ?? fallback);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${key} must be positive`);
  return n;
};
export const config = {
  root: process.cwd(),
  data: resolve(process.env.DATA_DIR ?? 'data'),
  baseUrl: process.env.NEBIUS_BASE_URL ?? 'https://api.tokenfactory.us-north1.nebius.com/v1/',
  model: process.env.NEBIUS_MODEL ?? 'meta-models/muse-spark-open',
  key: process.env.NEBIUS_API_KEY ?? '',
  limits: {
    maxSteps: positive('MAX_STEPS', 40),
    taskSeconds: positive('TASK_TIMEOUT_SECONDS', 1800),
    maxOutputTokens: positive('MAX_OUTPUT_TOKENS', 16384),
    taskCost: positive('MAX_TASK_COST_USD', 5),
    batchCost: positive('MAX_BATCH_COST_USD', 100),
  } satisfies Limits,
};
