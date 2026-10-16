import Decimal from 'decimal.js';
import type { Price, Usage, RequestRecord } from './domain.js';
export function estimate(usage: Usage | undefined, price: Price | undefined): string | null {
  if (
    !usage ||
    !price?.prompt ||
    !price.completion ||
    usage.prompt_tokens === undefined ||
    usage.completion_tokens === undefined
  )
    return null;
  const input = usage.prompt_tokens,
    output = usage.completion_tokens,
    cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  if ([input, output, cached].some((x) => !Number.isFinite(x) || x < 0) || cached > input)
    return null;
  const amount = new Decimal(input - (price.cache ? cached : 0))
    .mul(price.prompt)
    .add(new Decimal(price.cache ? cached : 0).mul(price.cache ?? 0))
    .add(new Decimal(output).mul(price.completion));
  return amount.toFixed(10);
}
export function totals(requests: RequestRecord[]) {
  return {
    input: requests.reduce((s, r) => s + (r.usage?.prompt_tokens ?? 0), 0),
    output: requests.reduce((s, r) => s + (r.usage?.completion_tokens ?? 0), 0),
    reasoning: requests.reduce(
      (s, r) => s + (r.usage?.completion_tokens_details?.reasoning_tokens ?? 0),
      0,
    ),
    cached: requests.reduce((s, r) => s + (r.usage?.prompt_tokens_details?.cached_tokens ?? 0), 0),
    calls: requests.length,
    cost: requests.reduce((s, r) => s.add(r.cost ?? 0), new Decimal(0)).toFixed(8),
    usageComplete: requests.length > 0 && requests.every((r) => r.complete),
    costComplete: requests.length > 0 && requests.every((r) => r.complete && r.cost !== null),
  };
}
export function wilson(pass: number, total: number) {
  if (!total) return null;
  const z = 1.96,
    p = pass / total,
    d = 1 + (z * z) / total,
    c = (p + (z * z) / (2 * total)) / d,
    h = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total)) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
