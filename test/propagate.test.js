import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalize, validate, computeProven, isRoot, missingFor, waitsOn, rippleOrder, reach, reachFrom, layers, homes, foundationsOf, restsOn, followsFrom, bridges } from '../js/propagate.js';

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
    // An entry from the bulk import (tools/import) may lack `by`: where the article names nobody, nobody is guessed.
    const system = n.kind === 'system';
    const imported = n.origin === 'wikipedia-import';
    for (const key of ['id', 'name', 'short', 'statement', 'kind', 'url', 'area', ...(system ? [] : imported ? ['base'] : ['base', 'by'])]) {
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
    // `anyOf` says "any one of these would prove it", which only an open statement can say.
    if (n.anyOf.length) assert.equal(n.base, 'open', `${n.id}: anyOf on a statement that is not open`);
  }
});

test('a link the bulk import gave an open statement is one way to it, not a part of the only way', () => {
  // The import reads one sentence at a time ("X follows from Y"). Two such links in `needs` would say
  // that X needs both; tools/import/merge.cjs puts them in `anyOf`. A single link stays in `needs`.
  for (const n of files.flatMap((f) => f.data.nodes)) {
    if (n.base !== 'open') continue;
    const needs = n.needs || [];
    const imported = n.origin === 'wikipedia-import' ? needs : needs.filter((x) => x.origin === 'wikipedia-import');
    if (imported.length) assert.equal(needs.length + (n.anyOf || []).length, 1, `${n.id}: imported links in needs next to other links`);
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
  // The entries of the bulk import are not counted: about half of their articles give no year in the parts that are read.
  assert.ok(nodes.filter((n) => n.kind !== 'system' && n.origin !== 'wikipedia-import' && n.year === undefined).length <= 5, 'too many statements without a year');
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
  // Nothing floats: from every entry that is not itself an axiom, what it rests
  // on and the systems it is built in (`within`) lead down to ZF set theory,
  // which is built within axioms that are assumed by default. What an open
  // statement would follow from does not count, so every open statement needs
  // a `within` of its own.
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

test('whatever holds rests only on what holds', () => {
  // If a statement is proven, everything it rests on is proven. Before this was
  // checked, the Riemann Hypothesis was drawn as resting on GRH, which it would
  // only follow from: proven on 20 Nov 2026 while GRH stayed open.
  for (const marks of [index.assumed, [...index.assumed, ...index.today.proven]]) {
    const holds = proven(...marks);
    for (const id of holds) for (const need of restsOn(byId.get(id))) assert.ok(holds.has(need), `${id} holds but rests on ${need}, which does not`);
  }
});

test('an open statement rests on nothing: what it lists is what it would follow from', () => {
  for (const n of nodes) {
    assert.deepEqual([...restsOn(n), ...followsFrom(n)].sort(), [...n.needs, ...n.anyOf].sort(), n.id);
    if (n.base === 'open') assert.deepEqual(restsOn(n), [], n.id);
    else assert.deepEqual(followsFrom(n), [], n.id);
  }
  assert.deepEqual(followsFrom(byId.get('rh')), ['grh']);
  assert.deepEqual(restsOn(byId.get('von-koch')), ['rh']);
  // In the tree the Riemann Hypothesis therefore stands on its theory, not on GRH, and every axiom is in the bottom row.
  const layer = layers(nodes);
  assert.ok(!foundationsOf(byId.get('rh')).includes('grh') && foundationsOf(byId.get('rh')).length > 0);
  for (const n of nodes) if (n.kind === 'axiom') assert.equal(layer.get(n.id), 0, `${n.id} is an axiom above the bottom row`);
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

test('every entry has one home, the highest thing it stands on, and the homes lead down to set theory', () => {
  const sample = normalize([
    { id: 'axiom', kind: 'axiom', base: 'open' },
    { id: 'sets', kind: 'system', within: ['axiom'] },
    { id: 'numbers', kind: 'system', within: ['sets'] },
    { id: 'lemma', base: 'proven', within: ['numbers'] },
    { id: 'result', base: 'proven', needs: ['lemma'], within: ['sets'] },
    { id: 'guess', base: 'open', needs: ['result'], within: ['numbers'] },
  ]);
  // An open statement stands on its field only: what it lists in `needs` is what it would follow from.
  assert.deepEqual([...homes(sample)], [['axiom', null], ['sets', null], ['numbers', 'sets'], ['lemma', 'numbers'], ['result', 'lemma'], ['guess', 'numbers']]);

  const home = homes(nodes);
  const centres = nodes.filter((n) => n.kind !== 'axiom' && home.get(n.id) === null).map((n) => n.id);
  assert.deepEqual(centres, ['zf-set-theory']);
  for (const n of nodes) {
    if (home.get(n.id) !== null) assert.ok(foundationsOf(n).includes(home.get(n.id)), `${n.id} is placed at something it does not stand on`);
    else assert.ok(n.kind === 'axiom' || n.id === 'zf-set-theory', `${n.id} has no home`);
  }
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
  // `after` rests on `either`; `either` would follow from `b` and does not rest on it.
  assert.equal(reach(sample, 'either', 'down').get('after'), 1);
  assert.deepEqual([...reach(sample, 'b', 'down').keys()], ['both']);
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

test('waitsOn names the nearest open statements a conditional result was proven under', () => {
  // The short-intervals result was proven assuming the density hypothesis. That would follow from RH, but the result does not need RH.
  assert.deepEqual(waitsOn(nodes, proven(), 'short-intervals'), ['density']);
  assert.deepEqual(waitsOn(nodes, proven(), 'von-koch'), ['rh']);
  assert.deepEqual(waitsOn(nodes, proven('rh'), 'short-intervals'), []);
  const sample = normalize([
    { id: 'h', kind: 'hypothesis', base: 'open' },
    { id: 'first', kind: 'theorem', base: 'conditional', needs: ['h'] },
    { id: 'second', kind: 'theorem', base: 'conditional', needs: ['first'] },
  ]);
  assert.deepEqual(waitsOn(sample, new Set(), 'second'), ['h']);
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

test('reach finds what rests on a statement and what it rests on, with the longest chain as distance', () => {
  const down = reach(nodes, 'rh', 'down');
  assert.equal(down.get('von-koch'), 1);
  assert.ok(!down.has('rh') && !down.has('grh') && !down.has('miller'));
  // The Lindelöf hypothesis would follow from RH; it and what was proven assuming it or its consequences do not rest on RH.
  assert.ok(!down.has('lindelof') && !down.has('density') && !down.has('short-intervals'));
  // Nor does RH, or anything that rests on it, rest on the stronger hypotheses it would follow from.
  assert.ok(!reach(nodes, 'grh', 'down').has('rh') && !reach(nodes, 'erh', 'down').has('von-koch'));
  assert.ok(reach(nodes, 'grh', 'down').has('miller'));
  assert.equal(reach(nodes, 'rh', 'up').size, 0);

  const up = reach(nodes, 'short-intervals', 'up');
  assert.deepEqual([...up], [['density', 1]]);
  // A chain of results that each rest on the one before.
  const chain = normalize([
    { id: 'a', kind: 'theorem', base: 'proven' },
    { id: 'b', kind: 'theorem', base: 'proven', needs: ['a'] },
    { id: 'c', kind: 'theorem', base: 'proven', needs: ['a', 'b'] },
  ]);
  assert.deepEqual([...reach(chain, 'a', 'down')].sort(), [['b', 1], ['c', 2]]);
  assert.deepEqual([...reach(chain, 'c', 'up')].sort(), [['a', 2], ['b', 1]]);

  assert.equal(reach(nodes, 'legendre', 'down').size, 0);
});

test('one reachFrom lookup, used for every entry, answers like a fresh reach each time', () => {
  for (const direction of ['down', 'up']) {
    for (const linksOf of [undefined, foundationsOf]) {
      const lookup = reachFrom(nodes, direction, linksOf);
      for (const n of nodes) assert.deepEqual([...lookup(n.id)], [...reach(nodes, n.id, direction, linksOf)], `${n.id} ${direction}`);
    }
  }
});

/* ---------- the page ---------- */

test('index.html asks for every data file up front', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const file of ['index.json', ...index.areas.map((a) => a.file)]) {
    assert.ok(html.includes(`<link rel="preload" href="data/${file}" as="fetch" crossorigin>`), `index.html has no preload line for data/${file}: add one next to the others`);
  }
});

test('bridges join a shown entry to the nearest shown entries below it, past hidden ones', () => {
  const sample = normalize([
    { id: 'axiom', kind: 'axiom', base: 'open' },
    { id: 'sets', kind: 'system', within: ['axiom'] },
    { id: 'numbers', kind: 'system', within: ['sets'] },
    { id: 'lemma', kind: 'theorem', base: 'proven', within: ['numbers'] },
    { id: 'result', kind: 'theorem', base: 'proven', needs: ['lemma'] },
    { id: 'top', kind: 'theorem', base: 'proven', needs: ['result'], within: ['numbers'] },
  ]);
  const standsOn = (b, a) => reach(sample, b, 'up', foundationsOf).has(a);
  const of = (...shown) => bridges(sample, new Set(shown), standsOn).map((l) => `${l.source}>${l.target}${l.needsOnly ? ' needs' : ''}`).sort();

  assert.deepEqual(of('axiom', 'sets', 'numbers', 'lemma', 'result', 'top'), []);
  assert.deepEqual(of('axiom', 'numbers', 'result'), ['axiom>numbers', 'numbers>result']);
  // Through `needs` alone, and not a second time through the system the chain passes.
  assert.deepEqual(of('lemma', 'top', 'axiom'), ['axiom>lemma', 'lemma>top needs']);
  // `top` is linked to `numbers` directly, so no bridge to what `numbers` stands on.
  assert.deepEqual(of('axiom', 'numbers', 'top'), ['axiom>numbers']);
});
