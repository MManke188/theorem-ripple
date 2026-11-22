import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate, computeProven, isRoot, missingFor, rippleOrder } from '../js/propagate.js';

const data = JSON.parse(readFileSync(new URL('../data/theorems.json', import.meta.url), 'utf8'));
const nodes = data.nodes;
const byId = new Map(nodes.map((n) => [n.id, n]));
const proven = (...ids) => computeProven(nodes, new Set(ids));

test('data is consistent: ids exist, no cycles, required fields present', () => {
  validate(nodes);
  for (const n of nodes) {
    for (const key of ['id', 'name', 'short', 'statement', 'kind', 'base', 'by', 'url']) {
      assert.ok(n[key], `${n.id} is missing ${key}`);
    }
    assert.ok(['hypothesis', 'theorem', 'data'].includes(n.kind), `${n.id} kind`);
    assert.ok(['open', 'conditional', 'proven'].includes(n.base), `${n.id} base`);
    if (n.base === 'conditional') assert.ok(n.needs.length > 0, `${n.id} is conditional on nothing`);
  }
  for (const id of [...data.today.proven, ...data.today.claimed]) assert.ok(byId.has(id), id);
});

test('validate rejects unknown ids and cycles', () => {
  assert.throws(() => validate([{ id: 'a', needs: ['nope'] }]), /unknown id/);
  assert.throws(() => validate([{ id: 'a', needs: ['b'] }, { id: 'b', needs: ['a'] }]), /cycle/);
});

test('before the proof only unconditional results are proven', () => {
  const set = proven();
  assert.deepEqual([...set].sort(), nodes.filter((n) => n.base === 'proven').map((n) => n.id).sort());
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
  for (const id of ['rh', 'grh', 'erh', 'legendre', 'pair-correlation']) assert.ok(isRoot(nodes, id), id);
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
