import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { config } from './config.js';
import { estimate, totals } from './accounting.js';
import { hash, id, now, type Price, type RequestRecord, type Usage, type Run } from './domain.js';
import type { Store } from './store.js';
export class BudgetError extends Error {}
export async function catalog(signal?: AbortSignal): Promise<Price> {
  if (!config.key) throw new Error('NEBIUS_API_KEY is not configured');
  const response = await fetch(new URL('models?verbose=true', config.baseUrl), {
    headers: { Authorization: `Bearer ${config.key}` },
    signal: signal ?? AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Nebius catalog returned HTTP ${response.status}`);
  const json = (await response.json()) as { data: Array<Record<string, unknown>> };
  const model = json.data.find((m) => m.id === config.model);
  if (!model) throw new Error(`Model ${config.model} is unavailable for this key`);
  const rates = (model.pricing ?? {}) as Record<string, string>;
  const rate = (v: unknown) => (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? v : undefined);
  return {
    at: now(),
    model: config.model,
    currency: 'USD',
    unit: 'token',
    prompt: rate(rates.prompt),
    completion: rate(rates.completion),
    cache: rate(rates.input_cache_read ?? rates.cache_read),
    raw: model,
  };
}
export function provider(store: Store, run: Run, price: Price, signal: AbortSignal) {
  const capturedFetch: typeof fetch = async (input, init) => {
    signal.throwIfAborted();
    const total = totals(store.requests(run.id));
    if (total.calls && !total.usageComplete)
      throw new BudgetError('Usage missing from prior request; budget accounting cannot continue');
    if (Number(total.cost) >= run.limits.taskCost)
      throw new BudgetError('Task inference cost limit reached');
    const batchRequests = store
      .all<RequestRecord>('request')
      .filter((r) => store.get<Run>('run', r.runId)?.benchmarkId === run.benchmarkId);
    if (Number(totals(batchRequests).cost) >= run.limits.batchCost)
      throw new BudgetError('Batch inference cost limit reached');
    const body = JSON.parse(String(init?.body ?? '{}'));
    // Never allow a framework-injected setting to change provider defaults.
    for (const key of [
      'reasoning_effort',
      'temperature',
      'top_p',
      'top_k',
      'presence_penalty',
      'frequency_penalty',
    ])
      delete body[key];
    if (body.stream) body.stream_options = { include_usage: true };
    const request: RequestRecord = {
      id: id(),
      runId: run.id,
      startedAt: now(),
      status: null,
      cost: null,
      complete: false,
      inputHash: hash(body),
      requestSettings: {
        model: body.model,
        stream: body.stream ?? false,
        max_tokens: body.max_tokens ?? null,
        defaults: true,
      },
    };
    store.put('request', request);
    store.event(run.id, 'model.started', {
      requestId: request.id,
      inputHash: request.inputHash,
      settings: request.requestSettings,
    });
    const finish = (usage: Usage | undefined, status: number, error?: string) => {
      request.status = status;
      request.finishedAt = now();
      request.usage = usage;
      request.cost = estimate(usage, price);
      request.complete =
        usage?.prompt_tokens !== undefined && usage?.completion_tokens !== undefined;
      request.error = error;
      store.put('request', request);
      store.event(run.id, 'model.finished', {
        requestId: request.id,
        status,
        usage: usage ?? null,
        cost: request.cost,
        complete: request.complete,
        error: error ?? null,
      });
    };
    let response: Response;
    try {
      response = await fetch(input, { ...init, body: JSON.stringify(body), signal });
    } catch (error) {
      finish(undefined, 0, signal.aborted ? 'Request interrupted' : 'Provider transport failed');
      throw error;
    }
    request.status = response.status;
    store.put('request', request);
    if (!response.ok) {
      finish(undefined, response.status, `Provider HTTP ${response.status}`);
      return response;
    }
    if (!body.stream) {
      const raw = (await response.clone().json()) as { usage?: Usage };
      finish(raw.usage, response.status);
      return response;
    }
    const decoder = new TextDecoder();
    let buffer = '',
      usage: Usage | undefined;
    const parseLine = (line: string) => {
      if (!line.startsWith('data:')) return;
      const value = line.slice(5).trim();
      if (value === '[DONE]') return;
      try {
        const chunk = JSON.parse(value);
        if (chunk.usage) usage = chunk.usage;
      } catch {
        /* Ignore keepalive and incomplete SSE lines. */
      }
    };
    const stream = response.body!.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) parseLine(line);
          controller.enqueue(chunk);
        },
        flush() {
          buffer += decoder.decode();
          if (buffer) parseLine(buffer);
          finish(usage, response.status);
        },
      }),
    );
    return new Response(stream, { status: response.status, headers: response.headers });
  };
  return createOpenAICompatible({
    name: 'nebius',
    baseURL: config.baseUrl,
    apiKey: config.key,
    fetch: capturedFetch,
  }).chatModel(config.model);
}
