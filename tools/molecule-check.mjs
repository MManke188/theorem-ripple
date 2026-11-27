// Works out the Molecule arrangement without a browser and says how the subjects came to lie.
//
// Usage: node tools/molecule-check.mjs
// It takes the functions ballPlaces and layoutMolecule out of js/app.js as text and runs them on the data, once
// for each shape of window (flat, wide, tall). Per shape it prints the size of the map in pixels, how long the
// layout took, and counts:
//   subjects whose rings overlap; bonds between subjects that cross each other; bonds that run through the
//   rings of a third subject; bonds that are not in one of the six directions. All four should be 0.
// It also prints how many bonds have the shortest possible length (the two subjects' rings touch), the longest
// bond, and the two statements outside the balls that lie closest to each other.
import fs from 'node:fs';
import { normalize, homes, foundationsOf, reachFrom } from '../js/propagate.js';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const nodes = normalize(JSON.parse(read('data/index.json')).areas.flatMap((a) => JSON.parse(read(`data/${a.file}`)).nodes));
const byId = new Map(nodes.map((n) => [n.id, n]));
const node = (id) => byId.get(id);
const home = homes(nodes);
const above = reachFrom(nodes, 'down', foundationsOf);

const app = read('js/app.js');
const from = app.indexOf('function ballPlaces(');
const to = app.indexOf('\n}\n', app.indexOf('function layoutMolecule('));
if (from < 0 || to < 0 || !app.slice(from, to).includes('return pos;')) throw new Error('ballPlaces and layoutMolecule not found in js/app.js, or layoutMolecule no longer ends with "return pos;"');
// Besides the positions, hand out the subjects where they ended up and the bonds between them.
const body = app.slice(from, to).replace(/return pos;\s*$/, 'return { pos, at: best.at };') + '\n}';

// The part of the page's `state` and of each entry that layoutMolecule reads (see init in js/app.js).
const state = { nodes, around: new Map(nodes.map((n) => [n.id, []])), inBall: new Map() };
const { ballRadius, layoutMolecule } = new Function('state', 'node', `${body}; return { ballRadius, layoutMolecule };`)(state, node);
for (const n of nodes) {
  n.home = home.get(n.id);
  n.above = above(n.id);
  if (n.home) state.around.get(n.home).push(n.id);
}
state.middle = nodes.find((n) => !n.home && n.kind !== 'axiom');
if (state.middle.kind !== 'system') throw new Error(`${state.middle.id} stands on axioms alone and is not a system: the molecule has no centre`);
for (const n of nodes) {
  const plain = n.kind !== 'system' && n.home && node(n.home).kind === 'system' && !state.around.get(n.id).length;
  n.ballOf = plain ? n.home : n.kind === 'axiom' ? state.middle.id : null;
  if (n.kind === 'system') state.inBall.set(n.id, []);
}
for (const n of nodes) if (n.ballOf) state.inBall.get(n.ballOf).push(n.id);
for (const n of nodes) if (n.kind === 'system') n.ball = ballRadius(state.inBall.get(n.id).length);

// On which side of the line a-b the point c lies; 0 on the line: bonds in one straight line do not cross.
const side = (a, b, c) => {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return Math.abs(v) < 1 ? 0 : Math.sign(v);
};
for (const shape of ['flat', 'wide', 'tall']) {
  const t0 = performance.now();
  const { pos, at } = layoutMolecule(shape);
  const ms = performance.now() - t0;
  const discs = at.id.map((id, i) => ({ id, name: node(id).short, x: at.x[i], y: at.y[i], r: at.reach[i] }));
  const bonds = at.from.map((p, i) => [p, at.to[i]]).map(([p, q]) => ({ a: discs[p], b: discs[q], name: `${discs[p].name}–${discs[q].name}`, length: Math.hypot(discs[p].x - discs[q].x, discs[p].y - discs[q].y) }));
  const span = (k) => Math.max(...[...pos.values()].map((p) => p[k])) - Math.min(...[...pos.values()].map((p) => p[k]));
  const overlapping = [];
  discs.forEach((a, i) => discs.slice(i + 1).forEach((b) => a.r + b.r - Math.hypot(a.x - b.x, a.y - b.y) > 0.05 && overlapping.push(`${a.name} and ${b.name}`)));
  const crossing = [];
  bonds.forEach((p, i) =>
    bonds.slice(i + 1).forEach((q) => {
      if (new Set([p.a, p.b, q.a, q.b]).size === 4 && side(p.a, p.b, q.a) * side(p.a, p.b, q.b) < 0 && side(q.a, q.b, p.a) * side(q.a, q.b, p.b) < 0) crossing.push(`${p.name} and ${q.name}`);
    }),
  );
  const through = [];
  for (const l of bonds) {
    for (const d of discs) {
      if (d === l.a || d === l.b) continue;
      const [ax, ay, bx, by] = [l.a.x, l.a.y, l.b.x, l.b.y];
      const t = Math.max(0, Math.min(1, ((d.x - ax) * (bx - ax) + (d.y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
      if (Math.hypot(ax + t * (bx - ax) - d.x, ay + t * (by - ay) - d.y) < d.r) through.push(`${l.name} through ${d.name}`);
    }
  }
  // All bonds run in six directions: their angles differ by multiples of 60 degrees.
  const angle = (l) => (((Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x) * 180) / Math.PI) % 60 + 60) % 60;
  const off = bonds.filter((l) => Math.min(Math.abs(angle(l) - angle(bonds[0])), 60 - Math.abs(angle(l) - angle(bonds[0]))) > 0.01).map((l) => l.name);
  const touching = bonds.filter((l) => l.length < l.a.r + l.b.r + 1).length;
  const longest = bonds.reduce((a, b) => (b.length > a.length ? b : a));
  const outside = nodes.filter((n) => !n.ballOf).map((n) => [n.short, ...pos.get(n.id)]);
  let nearest = [Infinity];
  outside.forEach((p, i) => {
    for (let j = i + 1; j < outside.length; j++) {
      const d = Math.hypot(p[1] - outside[j][1], p[2] - outside[j][2]);
      if (d < nearest[0]) nearest = [d, p[0], outside[j][0]];
    }
  });
  const missing = nodes.filter((n) => !pos.has(n.id) || pos.get(n.id).some((v) => !Number.isFinite(v))).length;
  console.log(`${shape}: ${Math.round(span(0))} x ${Math.round(span(1))} px in ${Math.round(ms)} ms, ${pos.size} of ${nodes.length} entries placed${missing ? `, ${missing} WITHOUT A PLACE` : ''}`);
  console.log(`  overlapping subjects: ${overlapping.length}${overlapping.length ? ` (${overlapping.join('; ')})` : ''}`);
  console.log(`  crossing bonds: ${crossing.length}${crossing.length ? ` (${crossing.join('; ')})` : ''}`);
  console.log(`  bonds through a third subject: ${through.length}${through.length ? ` (${through.join('; ')})` : ''}`);
  console.log(`  bonds outside the six directions: ${off.length}${off.length ? ` (${off.join('; ')})` : ''}`);
  console.log(`  ${touching} of ${bonds.length} bonds have the shortest possible length; the longest is ${longest.name} with ${Math.round(longest.length)} px`);
  console.log(`  closest two statements outside the balls: ${nearest[1]} and ${nearest[2]}, ${Math.round(nearest[0])} px apart`);
}
