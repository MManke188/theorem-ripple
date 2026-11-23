import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalize, validate, computeProven, isRoot, missingFor, rippleOrder, reach, layers, foundationsOf } from '../js/propagate.js';

const read = (file) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8'));
const index = read('index.json');
const files = index.areas.map((a) => ({ area: a, data: read(a.file) }));
const nodes = normalize(files.flatMap((f) => f.data.nodes));
const byId = new Map(nodes.map((n) => [n.id, n]));
const proven = (...ids) => computeProven(nodes, new Set(ids));

/* ---------- the data files ---------- */

test('data is consistent: ids unique across files, links exist, no cycles, fields present', () => {
  validate(nodes);
  for (const { area, data } of files) {
    assert.equal(data.area, area.id, `${area.file} declares its area`);
    for (const n of data.nodes) assert.equal(n.area, area.id, `${n.id} is in ${area.file} but says area ${n.area}`);
  }
  for (const n of nodes) {
    // A system (a number system or a theory) is not a statement: it has no status and no author is required.
    const system = n.kind === 'system';
    for (const key of ['id', 'name', 'short', 'statement', 'kind', 'url', 'area', ...(system ? [] : ['base', 'by'])]) {
      assert.ok(n[key], `${n.id} is missing ${key}`);
    }
    assert.ok(n.short.length <= 40, `${n.id}: label too long`);
    assert.ok(['hypothesis', 'theorem', 'data', 'axiom', 'system'].includes(n.kind), `${n.id} kind`);
    if (system) assert.deepEqual([n.base, n.needs, n.anyOf], [undefined, [], []], `${n.id}: a system has no status and needs nothing; it is built within other systems`);
    else assert.ok(['open', 'conditional', 'proven'].includes(n.base), `${n.id} base`);
    for (const ref of n.within) assert.ok(['system', 'axiom'].includes(byId.get(ref).kind), `${n.id}.within lists ${ref}, which is neither a system nor an axiom`);
    assert.doesNotThrow(() => new URL(n.url), `${n.id} url`);
    for (const url of Object.values(n.needUrl)) assert.doesNotThrow(() => new URL(url), `${n.id} link url`);
    if (n.kind === 'axiom' || n.kind === 'hypothesis') assert.notEqual(n.base, 'conditional', `${n.id}: a hypothesis or axiom is open or proven`);
    if (n.equivalent) assert.equal(n.needs.length, 1, `${n.id}: equivalent to exactly one statement`);
  }
});

test('years are plausible, and almost every statement has one', () => {
  // `year`: when the statement was first stated or proven. `settled`: when a
  // statement that started as a conjecture was proven. Left out where the
  // sources give no date, never guessed.
  const thisYear = Number(index.today.date.slice(0, 4));
  for (const n of nodes) {
    for (const key of ['year', 'settled', 'formerlyYear']) {
      if (n[key] === undefined) continue;
      // Years before the common era are negative (Euclid: -300).
      assert.ok(Number.isInteger(n[key]) && n[key] >= -600 && n[key] !== 0 && n[key] <= thisYear, `${n.id}.${key} = ${n[key]}`);
    }
    if (n.settled !== undefined) {
      assert.notEqual(n.base, 'open', `${n.id} has a settled year but is open`);
      assert.ok(n.settled > n.year, `${n.id}: settled before it was stated`);
    }
    if (n.formerlyYear !== undefined) assert.ok(n.formerly.length > 0, `${n.id}: formerlyYear without formerly`);
  }
  assert.ok(nodes.filter((n) => n.kind !== 'system' && n.year === undefined).length <= 5, 'too many statements without a year');
});

test('no statement is isolated', () => {
  const linked = new Set();
  for (const n of nodes) {
    for (const ref of [...n.needs, ...n.anyOf, ...n.within, ...n.related, ...n.formerly]) {
      linked.add(ref);
      linked.add(n.id);
    }
  }
  assert.deepEqual(nodes.filter((n) => !linked.has(n.id)).map((n) => n.id), []);
});

test('everything stands on the axioms of set theory', () => {
  // Nothing floats: from every entry that is not itself an axiom, the links
  // (`needs`, `anyOf`, `within`) lead down to ZF set theory, which is built
  // within axioms that are assumed by default.
  const zf = byId.get('zf-set-theory');
  assert.ok(zf.within.length > 0);
  for (const id of zf.within) assert.ok(byId.get(id).kind === 'axiom' && index.assumed.includes(id), `ZF is built within ${id}, which must be an assumed axiom`);
  const floating = nodes.filter((n) => n.kind !== 'axiom' && n !== zf && !reach(nodes, n.id, 'up', foundationsOf).has(zf.id));
  assert.deepEqual(floating.map((n) => n.id), []);
});

test('with nothing marked, exactly the statements recorded as proven are proven', () => {
  // Catches an open or conditional entry whose requirements are all proven
  // theorems: the page would silently show it as proven.
  assert.deepEqual([...proven()].sort(), nodes.filter((n) => n.base === 'proven').map((n) => n.id).sort());
});

test('a proven statement rests only on proven statements', () => {
  for (const n of nodes.filter((x) => x.base === 'proven')) {
    for (const need of n.needs) assert.equal(byId.get(need).base, 'proven', `${n.id} is proven but rests on ${need}`);
  }
});

test('the event and the default axioms refer to real entries', () => {
  for (const id of [...index.today.proven, ...index.today.claimed]) assert.ok(byId.has(id), id);
  for (const id of index.assumed) assert.equal(byId.get(id)?.kind, 'axiom', `${id} is assumed by default, so it must be an axiom`);
});

/* ---------- the logic ---------- */

test('normalize accepts links written as ids or as objects with a source', () => {
  const [n] = normalize([{ id: 'b', needs: ['a', { id: 'c', url: 'https://example.org/' }] }]);
  assert.deepEqual(n.needs, ['a', 'c']);
  assert.deepEqual(n.needUrl, { c: 'https://example.org/' });
  assert.deepEqual([n.related, n.formerly, n.within], [[], [], []]);
  const [w] = normalize([{ id: 'b', within: ['s', { id: 't', url: 'https://example.org/t' }] }]);
  assert.deepEqual(w.within, ['s', 't']);
  assert.deepEqual(w.needUrl, { t: 'https://example.org/t' });
});

test('layers and foundation walks include the systems a statement is built in', () => {
  const sample = normalize([
    { id: 'axiom', kind: 'axiom', base: 'open' },
    { id: 'sets', kind: 'system', within: ['axiom'] },
    { id: 'numbers', kind: 'system', within: ['sets'] },
    { id: 'lemma', base: 'proven', within: ['numbers'] },
    { id: 'result', base: 'proven', needs: ['lemma'], within: ['sets'] },
  ]);
  assert.deepEqual([...layers(sample)], [['axiom', 0], ['sets', 1], ['numbers', 2], ['lemma', 3], ['result', 4]]);
  assert.deepEqual([...reach(sample, 'result', 'up').keys()], ['lemma']);
  assert.deepEqual([...reach(sample, 'result', 'up', foundationsOf)].sort(), [['axiom', 4], ['lemma', 1], ['numbers', 2], ['sets', 3]]);
  assert.deepEqual([...reach(sample, 'sets', 'down', foundationsOf).keys()].sort(), ['lemma', 'numbers', 'result']);
  // A system holds no status, and what is built in it does not become proven through it.
  assert.deepEqual([...computeProven(sample, new Set(['axiom']))].sort(), ['axiom', 'lemma', 'result']);
  assert.throws(() => validate(normalize([{ id: 'a', within: ['b'] }, { id: 'b', within: ['a'] }])), /cycle/);
});

test('a statement with several independent routes is proven by any one of them', () => {
  const sample = normalize([
    { id: 'a', base: 'open' },
    { id: 'b', base: 'open' },
    { id: 'either', base: 'open', anyOf: ['a', { id: 'b', url: 'https://example.org/' }] },
    { id: 'both', base: 'conditional', needs: ['a', 'b'] },
    { id: 'after', base: 'conditional', needs: ['either'] },
  ]);
  const none = computeProven(sample, new Set());
  const one = computeProven(sample, new Set(['a']));
  assert.ok(!none.has('either'));
  assert.ok(one.has('either') && one.has('after') && !one.has('both'));
  assert.equal(reach(sample, 'b', 'down').get('after'), 2);
  assert.equal(rippleOrder(sample, none, one).flipped.get('after'), 2);
});

test('validate rejects unknown ids and cycles', () => {
  assert.throws(() => validate([{ id: 'a', needs: ['nope'] }]), /unknown id/);
  assert.throws(() => validate([{ id: 'a', needs: ['b'] }, { id: 'b', needs: ['a'] }]), /cycle/);
});

test('proving RH proves its consequences, down the whole chain', () => {
  const set = proven('rh');
  for (const id of ['von-koch', 'robin', 'cramer-gap', 'littlewood-zeta-bound', 'lindelof', 'density', 'short-intervals']) {
    assert.ok(set.has(id), id);
  }
});

test('proving RH does not prove GRH or anything that needs it', () => {
  const set = proven('rh');
  for (const id of ['grh', 'erh', 'ankeny', 'miller', 'artin-primitive-root', 'legendre', 'cramer-conjecture']) {
    assert.ok(!set.has(id), id);
  }
});

test('results with two requirements stay conditional until both hold', () => {
  assert.ok(!proven('rh').has('goldston-heath-brown'));
  assert.ok(proven('rh', 'pair-correlation').has('goldston-heath-brown'));
  assert.ok(!proven('grh').has('chebyshev-bias'));
  assert.ok(proven('grh', 'linear-independence').has('chebyshev-bias'));
});

test('a stronger hypothesis proves the weaker ones', () => {
  const grh = proven('grh');
  assert.ok(grh.has('rh') && grh.has('von-koch') && grh.has('miller'));
  assert.ok(!grh.has('erh') && !grh.has('artin-primitive-root'));
  const erh = proven('erh');
  assert.ok(erh.has('grh') && erh.has('rh') && erh.has('class-group-tables'));
});

test('root hypotheses are told apart from hypotheses that follow from results', () => {
  for (const id of ['rh', 'grh', 'erh', 'legendre', 'pair-correlation', ...index.assumed]) assert.ok(isRoot(nodes, id), id);
  for (const id of ['lindelof', 'density', 'vinogradov-conjecture', 'miller']) assert.ok(!isRoot(nodes, id), id);
});

test('missingFor names the root hypotheses a result still waits on', () => {
  assert.deepEqual(missingFor(nodes, proven(), 'short-intervals'), ['rh']);
  assert.deepEqual(missingFor(nodes, proven('rh'), 'miller'), ['grh']);
  assert.deepEqual(missingFor(nodes, proven('rh'), 'goldston-heath-brown'), ['pair-correlation']);
  assert.deepEqual(missingFor(nodes, proven('rh'), 'class-group-tables'), ['erh']);
});

test('ripple rings follow the dependency chain', () => {
  const { flipped, touched } = rippleOrder(nodes, proven(), proven('rh'));
  assert.equal(flipped.get('rh'), 0);
  assert.equal(flipped.get('von-koch'), 1);
  assert.equal(flipped.get('littlewood-zeta-bound'), 1);
  assert.equal(flipped.get('lindelof'), 2);
  assert.equal(flipped.get('density'), 3);
  assert.equal(flipped.get('short-intervals'), 4);
  assert.ok(!flipped.has('grh') && !flipped.has('ternary-goldbach'));
  assert.equal(touched.get('goldston-heath-brown'), 1);
  assert.ok(!touched.has('miller'));
});

test('a what-if on top of today only ripples through what is new', () => {
  const { flipped } = rippleOrder(nodes, proven('rh'), proven('rh', 'erh'));
  assert.equal(flipped.get('erh'), 0);
  assert.equal(flipped.get('grh'), 1);
  assert.equal(flipped.get('ankeny'), 2);
  assert.equal(flipped.get('sqrt-mod-p'), 3);
  assert.ok(!flipped.has('rh') && !flipped.has('von-koch'));
});

test('reach finds everything downstream and upstream, with the longest chain as distance', () => {
  const down = reach(nodes, 'rh', 'down');
  assert.equal(down.get('von-koch'), 1);
  assert.equal(down.get('lindelof'), 2);
  assert.equal(down.get('short-intervals'), 4);
  assert.ok(!down.has('rh') && !down.has('grh') && !down.has('miller'));

  const up = reach(nodes, 'short-intervals', 'up');
  assert.equal(up.get('density'), 1);
  assert.equal(up.get('rh'), 4);
  assert.equal(up.get('grh'), 5);
  assert.equal(up.get('erh'), 6);
  assert.ok(!up.has('von-koch'));

  assert.equal(reach(nodes, 'legendre', 'down').size, 0);
});
