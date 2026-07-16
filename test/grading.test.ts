import { describe, expect, test } from 'vitest';
import { czOK, ivOK } from '../src/client/quiz/grading.js';

// The two graders decide whether a player was right, which makes them the highest-consequence pure
// functions in the app — and until now the only completely untested ones. These are characterization
// tests: they pin down what the graders do TODAY, so the modes.ts refactor cannot quietly change
// what counts as a correct answer.

describe('czOK — fill-in-the-blank', () => {
  const cz = {
    pre: 'Splitting a dataset across nodes is ',
    post: '.',
    answer: 'sharding',
    alts: ['partitioning'],
  };

  test('accepts the exact answer', () => {
    expect(czOK('sharding', cz)).toBe(true);
  });

  test('is case- and whitespace-insensitive', () => {
    expect(czOK('  ShArDiNg  ', cz)).toBe(true);
  });

  test('accepts any listed alternative', () => {
    expect(czOK('partitioning', cz)).toBe(true);
  });

  test('rejects a wrong answer', () => {
    expect(czOK('replication', cz)).toBe(false);
  });

  test('rejects blank — a blank is not a free pass', () => {
    expect(czOK('', cz)).toBe(false);
    expect(czOK('   ', cz)).toBe(false);
  });

  test('a card with no alternatives accepts only the exact answer', () => {
    expect(czOK('sharding', { ...cz, alts: [] })).toBe(true);
    expect(czOK('partitioning', { ...cz, alts: [] })).toBe(false);
  });

  test('survives a card whose alts are missing entirely', () => {
    // The type says `alts` is required, but czOK still guards with `(cz.alts || [])` — and card data
    // is transformed from YAML at build time, so a malformed card is a runtime possibility the type
    // system does not actually prevent. The cast is the point of the test, not a workaround.
    const noAlts = { ...cz, alts: undefined } as unknown as typeof cz;
    expect(czOK('sharding', noAlts)).toBe(true);
    expect(czOK('partitioning', noAlts)).toBe(false);
  });
});

describe('ivOK — inverse recall (definition shown, topic typed back)', () => {
  test('accepts the exact topic', () => {
    expect(ivOK('load balancer', 'Load Balancer')).toBe(true);
  });

  test('accepts a keyword-complete answer with extra words around it', () => {
    // "consistent" + "hashing" are both significant and both present.
    expect(ivOK('it is consistent hashing', 'Consistent hashing')).toBe(true);
  });

  test('rejects an answer that misses too many significant words', () => {
    // 'circuit','breaker','pattern' are significant; one hit of three is below the 60% bar.
    expect(ivOK('breaker', 'Circuit breaker pattern')).toBe(false);
  });

  test('accepts at exactly the 60% threshold', () => {
    // 3 significant words, ceil(3 * 0.6) = 2 required.
    expect(ivOK('circuit breaker', 'Circuit breaker pattern')).toBe(true);
  });

  test('short words cannot carry a pass', () => {
    // Every word of the topic is <= 3 chars, so there are no significant words to match: only an
    // exact match can succeed. This is what stops "the" from grading "the CAP of it" as correct.
    expect(ivOK('a of', 'CAP')).toBe(false);
    expect(ivOK('cap', 'CAP')).toBe(true);
  });

  test('rejects blank', () => {
    expect(ivOK('', 'Anything')).toBe(false);
  });
});
