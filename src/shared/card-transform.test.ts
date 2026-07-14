import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  type RawCard,
  backBody,
  backMasked,
  chars,
  clozeObj,
  esc,
  hint,
  maskText,
  match,
  multi,
  toGameCard,
  topicWords,
} from './card-transform.js';

const raw = (over: Partial<RawCard>): RawCard => ({ id: 'A1', cat: 'A', topic: '', desc: '', ...over });

test('esc matches Python html.escape (& < > " \' in order)', () => {
  assert.equal(esc(`a & b < c > d "e" 'f'`), 'a &amp; b &lt; c &gt; d &quot;e&quot; &#x27;f&#x27;');
  // & must be escaped first so &lt; is not double-escaped
  assert.equal(esc('<&>'), '&lt;&amp;&gt;');
});

test('clozeObj splits the sentence on the single {} placeholder', () => {
  const c = raw({ cloze: { text: 'A {} app serves any request.', answer: 'stateless' } });
  assert.deepEqual(clozeObj(c), {
    pre: 'A ',
    post: ' app serves any request.',
    answer: 'stateless',
    alts: [],
  });
  assert.equal(clozeObj(raw({})), null);
});

test('clozeObj carries alts and handles a trailing blank', () => {
  const c = raw({ cloze: { text: 'the answer is {}', answer: 'x', alts: ['y'] } });
  assert.deepEqual(clozeObj(c), { pre: 'the answer is ', post: '', answer: 'x', alts: ['y'] });
});

test('chars sums topic + desc + items + extras + table', () => {
  const c = raw({
    topic: 'ab', // 2
    desc: 'cde', // 3
    items: ['fg'], // 2
    extras: [{ label: 'h', text: 'ij' }], // 1 + 2
    table: [['k'], ['lm']], // 1 + 2
  });
  assert.equal(chars(c), 2 + 3 + 2 + 1 + 2 + 1 + 2);
});

test('hint prefers an explicit hint, else derives a truncated opener', () => {
  assert.equal(hint(raw({ hint: 'start here' })), 'start here');
  assert.equal(hint(raw({ desc: 'short desc' })), 'short desc'); // <= 48 chars: used whole
  const long = 'This description is definitely longer than forty-eight characters total.';
  const h = hint(raw({ desc: long }));
  assert.ok(h.endsWith('…') && h.length <= 49, `got ${JSON.stringify(h)}`);
  assert.ok(!h.slice(0, -1).endsWith(' ')); // trimmed at a word boundary
});

test('match derives verb — purpose pairs from command cards', () => {
  const c = raw({
    topic: 'Essential kubectl commands',
    items: ['kubectl get — list resources', 'kubectl describe — details', 'kubectl logs — pod output'],
  });
  assert.deepEqual(match(c), [
    ['kubectl get', 'list resources'],
    ['kubectl describe', 'details'],
    ['kubectl logs', 'pod output'],
  ]);
  // fewer than 3 pairs → no match mode
  assert.equal(match(raw({ topic: 'commands', items: ['a — b'] })), null);
});

test('match passes through an explicit match=', () => {
  const c = raw({
    match: [
      ['RBAC', 'by role'],
      ['ABAC', 'by attribute'],
    ],
  });
  assert.deepEqual(match(c), [
    ['RBAC', 'by role'],
    ['ABAC', 'by attribute'],
  ]);
});

test('multi extracts member names only for framework / core-k8s cards', () => {
  const c = raw({
    topic: 'Agent frameworks',
    items: ['LangGraph — graph runtime', 'CrewAI (roles)', 'AutoGen — chat'],
  });
  assert.deepEqual(multi(c), ['LangGraph', 'CrewAI', 'AutoGen']);
  assert.equal(multi(raw({ topic: 'Caching', items: ['Redis — cache'] })), null);
});

test('topicWords keeps long words + acronyms, longest first, stopwords dropped', () => {
  const w = topicWords('Horizontal vs. vertical scaling with RAG');
  assert.ok(w.includes('horizontal') && w.includes('vertical') && w.includes('scaling'));
  assert.ok(w.includes('rag')); // acronym lowercased
  assert.ok(!w.includes('with')); // stopword
  // sorted by length descending
  for (let i = 1; i < w.length; i++) assert.ok(w[i - 1].length >= w[i].length);
});

test('maskText blanks a word and its \\w* suffix with 3–7 block chars', () => {
  // "shard" is a prefix of all three, so \bshard\w* matches each whole token.
  const out = maskText('sharding shards shard', ['shard']);
  assert.equal(out, '▁▁▁▁▁▁▁ ▁▁▁▁▁▁ ▁▁▁▁▁'); // sharding(8)→cap 7, shards(6)→6, shard(5)→5
  // a word that is NOT a prefix is left untouched
  assert.equal(maskText('scaling', ['scale']), 'scaling');
});

test('backMasked hides the topic words inside the answer', () => {
  const c = raw({ topic: 'Sharding', desc: 'Sharding splits data across nodes.' });
  const masked = backMasked(c, {});
  assert.ok(!masked.toLowerCase().includes('sharding'));
  assert.ok(masked.includes('▁'));
});

test('backBody renders desc, items, table, extras, and folds when asked', () => {
  const c = raw({
    desc: 'D',
    items: ['one'],
    table: [['H'], ['v']],
    extras: [{ label: 'e.g.', text: 'x' }],
    diagram: 'cap',
  });
  const diagrams = { cap: '<svg>CAP</svg>' };
  const open = backBody(c, diagrams, false);
  assert.ok(open.includes('<div class="desc">D</div>'));
  assert.ok(open.includes('<ul class="items"><li>one</li></ul>'));
  assert.ok(open.includes('<table class="tbl">'));
  assert.ok(open.includes('<svg>CAP</svg>'));
  assert.ok(!open.includes('<details'));
  // folded: extras + diagram go behind the disclosure
  const folded = backBody(c, diagrams, true);
  assert.ok(folded.includes('<details class="foldmore"><summary>More detail</summary>'));
});

test('toGameCard suppresses objective modes on recall-only cards', () => {
  const c = raw({
    topic: 'Open recall topic',
    desc: 'explain freely',
    recall: true,
    inverse: true,
    cloze: { text: 'a {} b', answer: 'x' },
    match: [
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ],
  });
  const gc = toGameCard(c, {});
  assert.equal(gc.recall, true);
  assert.equal(gc.cloze, null);
  assert.equal(gc.match, null);
  assert.equal(gc.multi, null);
  assert.equal(gc.manifest, null);
  assert.equal(gc.inverse, false); // inverse is suppressed on recall cards
});

/**
 * Every field the author docs advertise must actually reach the game.
 *
 * `multi:` was documented as "Explicit multi-select member names", accepted by the zod schema, and
 * then silently dropped: the transform only ever inferred a multi list from `items`, and only when
 * the topic happened to contain "framework" or "core k8s objects". A card could author the field
 * correctly and get no select-all mode. This is the test that would have caught it — and it is
 * written per-field, so the next field to be added cannot go dead the same way.
 */
test('an authored multi: list is honoured', () => {
  const c = {
    id: 'X1',
    cat: 'X',
    topic: 'ACID properties',
    desc: 'Transaction guarantees.',
    multi: ['Atomicity', 'Consistency', 'Isolation', 'Durability'],
  };
  assert.deepEqual(multi(c as never), ['Atomicity', 'Consistency', 'Isolation', 'Durability']);
});

test('a multi: list too short to make a question is rejected', () => {
  const c = { id: 'X2', cat: 'X', topic: 'Pair', desc: '', multi: ['one', 'two'] };
  assert.equal(multi(c as never), null);
});

test('the legacy items-inference still works for the cards that rely on it', () => {
  const c = {
    id: 'X3',
    cat: 'X',
    topic: 'Agent frameworks',
    desc: '',
    items: ['LangChain — chains', 'LlamaIndex (RAG)', 'CrewAI — crews'],
  };
  assert.deepEqual(multi(c as never), ['LangChain', 'LlamaIndex', 'CrewAI']);
});

test('an explicit list wins over the inference', () => {
  const c = {
    id: 'X4',
    cat: 'X',
    topic: 'Agent frameworks',
    desc: '',
    items: ['LangChain — chains', 'LlamaIndex (RAG)', 'CrewAI — crews'],
    multi: ['Only', 'These', 'Three'],
  };
  assert.deepEqual(multi(c as never), ['Only', 'These', 'Three']);
});
