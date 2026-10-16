import { describe, it, expect } from 'vitest';
import { estimate, totals, wilson } from '../src/accounting';
import { hash, type Price, type RequestRecord } from '../src/domain';
const price: Price = {
  at: '2026-10-16',
  model: 'm',
  currency: 'USD',
  unit: 'token',
  prompt: '0.00000125',
  completion: '0.00000425',
  cache: '0.00000015',
  raw: {},
};
describe('provider accounting', () => {
  it('counts cached input separately and reasoning inside output only once', () => {
    expect(
      estimate(
        {
          prompt_tokens: 1000,
          completion_tokens: 500,
          prompt_tokens_details: { cached_tokens: 400 },
          completion_tokens_details: { reasoning_tokens: 300 },
        },
        price,
      ),
    ).toBe('0.0029350000');
  });
  it('keeps missing usage or pricing unknown', () => {
    expect(estimate(undefined, price)).toBeNull();
    expect(estimate({ prompt_tokens: 4 }, price)).toBeNull();
    expect(
      estimate({ prompt_tokens: 1, completion_tokens: 2 }, { ...price, completion: undefined }),
    ).toBeNull();
  });
  it('rejects impossible cached counts', () =>
    expect(
      estimate(
        { prompt_tokens: 1, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 3 } },
        price,
      ),
    ).toBeNull());
  it('sums every request including repeated input, and marks incomplete ledgers', () => {
    const requests = [
      {
        id: 'a',
        usage: { prompt_tokens: 1000, completion_tokens: 50 },
        cost: '0.01',
        complete: true,
      },
      {
        id: 'b',
        usage: { prompt_tokens: 1100, completion_tokens: 100 },
        cost: '0.02',
        complete: true,
      },
      { id: 'c', cost: null, complete: false },
    ] as RequestRecord[];
    expect(totals(requests)).toMatchObject({
      input: 2100,
      output: 150,
      calls: 3,
      cost: '0.03000000',
      usageComplete: false,
      costComplete: false,
    });
  });
  it('does not claim empty ledgers are measured zeros', () =>
    expect(totals([])).toMatchObject({ costComplete: false, usageComplete: false, calls: 0 }));
  it('uses a real byte SHA-256 digest for artifacts', () =>
    expect(hash(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    ));
});
describe('confidence intervals', () => {
  it('has no confidence interval without observations', () => expect(wilson(0, 0)).toBeNull());
  it('bounds zero and full success confidence intervals', () => {
    expect(wilson(0, 50)![0]).toBe(0);
    expect(wilson(50, 50)![1]).toBe(1);
  });
});
