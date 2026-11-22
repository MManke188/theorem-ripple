// Pure dependency logic: no DOM, shared by the page and the tests.
//
// A node is proven when it is proven outright (base "proven"), when it was
// marked proven (an event such as the 2026 proof, or a what-if), or when it
// lists requirements in `needs` and every one of them is proven.

const index = (nodes) => new Map(nodes.map((n) => [n.id, n]));
const needsOf = (n) => n.needs || [];

export function validate(nodes) {
  const byId = new Map();
  for (const n of nodes) {
    if (byId.has(n.id)) throw new Error(`duplicate id: ${n.id}`);
    byId.set(n.id, n);
  }
  for (const n of nodes) {
    for (const key of ['needs', 'related', 'formerly']) {
      for (const ref of n[key] || []) {
        if (!byId.has(ref)) throw new Error(`${n.id}.${key} refers to unknown id: ${ref}`);
      }
    }
  }
  const seen = new Map(); // 1 = on the current path, 2 = finished
  const visit = (id, path) => {
    if (seen.get(id) === 2) return;
    if (seen.get(id) === 1) throw new Error(`dependency cycle: ${[...path, id].join(' -> ')}`);
    seen.set(id, 1);
    for (const need of needsOf(byId.get(id))) visit(need, [...path, id]);
    seen.set(id, 2);
  };
  for (const n of nodes) visit(n.id, []);
}

export function computeProven(nodes, marked) {
  const byId = index(nodes);
  const memo = new Map();
  const proven = (id) => {
    if (memo.has(id)) return memo.get(id);
    const n = byId.get(id);
    const needs = needsOf(n);
    const value = n.base === 'proven' || marked.has(id) || (needs.length > 0 && needs.every(proven));
    memo.set(id, value);
    return value;
  };
  return new Set(nodes.filter((n) => proven(n.id)).map((n) => n.id));
}

// A root hypothesis is one that stands on its own (RH, GRH, Legendre, ...),
// as opposed to a named hypothesis that is a consequence of a result
// (Lindelöf follows from Littlewood's bound).
export function isRoot(nodes, id) {
  const byId = index(nodes);
  const root = (cur) => {
    const n = byId.get(cur);
    return n.kind === 'hypothesis' && needsOf(n).every(root);
  };
  return root(id);
}

// The unproven root hypotheses a node is still waiting on.
export function missingFor(nodes, proven, id) {
  const byId = index(nodes);
  const out = new Set();
  const walk = (cur) => {
    for (const need of needsOf(byId.get(cur))) {
      if (proven.has(need)) continue;
      if (isRoot(nodes, need)) out.add(need);
      else walk(need);
    }
  };
  walk(id);
  return [...out];
}

// Order in which a change spreads. `flipped` holds the nodes that become
// proven, `touched` the nodes that gained a proven requirement but still lack
// another one. The number is the ripple ring: 0 for the nodes that were marked,
// otherwise one more than the latest requirement that flipped.
export function rippleOrder(nodes, before, after) {
  const byId = index(nodes);
  const flipped = new Map();
  const depth = (id) => {
    if (flipped.has(id)) return flipped.get(id);
    const parents = needsOf(byId.get(id)).filter((p) => after.has(p) && !before.has(p));
    const value = parents.length ? 1 + Math.max(...parents.map(depth)) : 0;
    flipped.set(id, value);
    return value;
  };
  for (const n of nodes) if (after.has(n.id) && !before.has(n.id)) depth(n.id);

  const touched = new Map();
  for (const n of nodes) {
    if (after.has(n.id)) continue;
    const parents = needsOf(n).filter((p) => flipped.has(p));
    if (parents.length) touched.set(n.id, 1 + Math.max(...parents.map((p) => flipped.get(p))));
  }
  return { flipped, touched };
}
