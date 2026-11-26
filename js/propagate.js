// Pure dependency logic: no DOM, shared by the page and the tests.
//
// A node is proven when it is proven outright (base "proven"), when it was
// marked proven (an event such as the 2026 proof, or a what-if), when it
// lists requirements in `needs` and every one of them is proven, or when any
// single statement in `anyOf` is proven (several independent routes to it).

const index = (nodes) => new Map(nodes.map((n) => [n.id, n]));
// Every statement a node lists, in `needs` or `anyOf`. "Proven" travels along
// all of these links.
const needsOf = (n) => [...(n.needs || []), ...(n.anyOf || [])];
// Such a link means one of two things, decided by the node that lists it.
// A proven or conditional node rests on what it lists: its proof uses that
// theorem or assumes that hypothesis. An open node rests on nothing yet: what
// it lists is a stronger statement it would follow from (the Riemann
// Hypothesis would follow from GRH). When the open node is proven some other
// way, the stronger statement stays open.
export const restsOn = (n) => (n.base === 'open' ? [] : n.needs || []);
export const followsFrom = (n) => (n.base === 'open' ? needsOf(n) : []);
// Everything a node stands on: what it rests on, plus the number systems and
// theories it is built in (`within`). Status never travels along `within`;
// it only says where a statement sits above the axioms.
export const foundationsOf = (n) => [...restsOn(n), ...(n.within || [])];

// Data files may write a link as "id" or as { id, url } when the link has its
// own source. This turns every node into the plain form the rest of the code
// uses: `needs`, `anyOf` and `within` are lists of ids, `needUrl` maps an id
// to its source.
export function normalize(raw) {
  return raw.map((n) => {
    const plain = (list) => (list || []).map((x) => (typeof x === 'string' ? { id: x } : x));
    const needs = plain(n.needs);
    const anyOf = plain(n.anyOf);
    const within = plain(n.within);
    return {
      ...n,
      needs: needs.map((x) => x.id),
      anyOf: anyOf.map((x) => x.id),
      within: within.map((x) => x.id),
      needUrl: Object.fromEntries([...needs, ...anyOf, ...within].filter((x) => x.url).map((x) => [x.id, x.url])),
      related: n.related || [],
      formerly: n.formerly || [],
    };
  });
}

export function validate(nodes) {
  const byId = new Map();
  for (const n of nodes) {
    if (byId.has(n.id)) throw new Error(`duplicate id: ${n.id}`);
    byId.set(n.id, n);
  }
  for (const n of nodes) {
    for (const key of ['needs', 'anyOf', 'within', 'related', 'formerly']) {
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
    for (const need of [...needsOf(byId.get(id)), ...(byId.get(id).within || [])]) visit(need, [...path, id]);
    seen.set(id, 2);
  };
  for (const n of nodes) visit(n.id, []);
}

// How high a node sits above the axioms: 0 with nothing below it, otherwise
// one more than the highest thing it stands on.
export function layers(nodes) {
  const byId = index(nodes);
  const layer = new Map();
  const measure = (id) => {
    if (layer.has(id)) return layer.get(id);
    const value = Math.max(-1, ...foundationsOf(byId.get(id)).map(measure)) + 1;
    layer.set(id, value);
    return value;
  };
  for (const n of nodes) measure(n.id);
  return layer;
}

// The one entry each node is placed at: the highest thing it stands on, and
// the first of them where several are equally high. Axioms have none, and
// neither has an entry that stands on axioms alone (set theory itself).
export function homes(nodes) {
  const layer = layers(nodes);
  return new Map(
    nodes.map((n) => {
      const home = foundationsOf(n).reduce((best, id) => (best !== null && layer.get(best) >= layer.get(id) ? best : id), null);
      return [n.id, home !== null && layer.get(home) > 0 ? home : null];
    }),
  );
}

export function computeProven(nodes, marked) {
  const byId = index(nodes);
  const memo = new Map();
  const proven = (id) => {
    if (memo.has(id)) return memo.get(id);
    const n = byId.get(id);
    const needs = n.needs || [];
    const value = n.base === 'proven' || marked.has(id) || (needs.length > 0 && needs.every(proven)) || (n.anyOf || []).some(proven);
    memo.set(id, value);
    return value;
  };
  return new Set(nodes.filter((n) => proven(n.id)).map((n) => n.id));
}

// A root hypothesis is one that stands on its own (RH, GRH, Legendre, an
// axiom, ...), as opposed to a named hypothesis that is a consequence of a
// result (Lindelöf follows from Littlewood's bound).
export function isRoot(nodes, id) {
  const byId = index(nodes);
  const root = (cur) => {
    const n = byId.get(cur);
    return (n.kind === 'hypothesis' || n.kind === 'axiom') && needsOf(n).every(root);
  };
  return root(id);
}

// Everything connected to a node in one direction, with its distance.
// 'down': the statements that rest on it, directly or through others.
// 'up': the statements it rests on. The number is the longest chain of links
// between the two, so a node is always further out than what it follows from.
// `linksOf` chooses the links to walk: what a node rests on (the default), or
// `foundationsOf` to include the systems it is built in. What an open
// statement would follow from is in neither.
export function reach(nodes, id, direction, linksOf = restsOn) {
  return reachFrom(nodes, direction, linksOf)(id);
}

// The same for many nodes: the table of links is built once, and the function
// returned answers for one id at a time.
export function reachFrom(nodes, direction, linksOf = restsOn) {
  const next = new Map(nodes.map((n) => [n.id, []]));
  const prev = new Map(nodes.map((n) => [n.id, []]));
  for (const n of nodes) {
    for (const need of linksOf(n)) {
      const [from, to] = direction === 'down' ? [need, n.id] : [n.id, need];
      next.get(from).push(to);
      prev.get(to).push(from);
    }
  }
  return (id) => {
    const members = new Set();
    const queue = [id];
    while (queue.length) {
      for (const to of next.get(queue.shift())) {
        if (!members.has(to)) {
          members.add(to);
          queue.push(to);
        }
      }
    }
    const depth = new Map([[id, 0]]);
    const measure = (cur) => {
      if (depth.has(cur)) return depth.get(cur);
      const value = 1 + Math.max(...prev.get(cur).filter((p) => p === id || members.has(p)).map(measure));
      depth.set(cur, value);
      return value;
    };
    members.forEach(measure);
    depth.delete(id);
    return depth;
  };
}

// Zoomed out, the page draws only the entries in `shown`, so a drawn entry may
// have lost the entries it stands on. This returns the links that keep the
// picture in one piece: from each shown entry to the nearest shown entries
// below it, reached through hidden ones. A link is left out when another shown
// entry below already leads there (`standsOn(b, a)`: b stands on a).
// `needsOnly` says that the hidden chain consists of `needs` links alone.
export function bridges(nodes, shown, standsOn) {
  const byId = index(nodes);
  const through = (id, linksOf) => {
    const found = new Set();
    const seen = new Set(linksOf(byId.get(id)).filter((p) => shown.has(p))); // linked directly: that line is drawn anyway
    const walk = (cur) => {
      for (const p of linksOf(byId.get(cur))) {
        if (seen.has(p)) continue;
        seen.add(p);
        if (shown.has(p)) found.add(p);
        else walk(p);
      }
    };
    walk(id);
    return found;
  };
  const out = [];
  for (const n of nodes) {
    if (!shown.has(n.id)) continue;
    const far = through(n.id, foundationsOf);
    const strict = through(n.id, restsOn);
    const ends = [...foundationsOf(n).filter((id) => shown.has(id)), ...far];
    for (const a of far) {
      if (!ends.some((b) => b !== a && standsOn(b, a))) out.push({ source: a, target: n.id, needsOnly: strict.has(a) });
    }
  }
  return out;
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

// The nearest unproven statements a conditional result was proven under, also
// through other conditional results it uses. Unlike missingFor this stops at
// the first open statement and does not go on to what that would follow from.
export function waitsOn(nodes, proven, id) {
  const byId = index(nodes);
  const out = new Set();
  const walk = (cur) => {
    for (const need of restsOn(byId.get(cur))) {
      if (proven.has(need)) continue;
      if (byId.get(need).base === 'open') out.add(need);
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
