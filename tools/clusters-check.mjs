// Works out the Clusters arrangement without a browser and says how the discs of the systems came to lie.
//
// Usage: node tools/clusters-check.mjs
// It takes the function layoutClusters out of js/app.js as text and runs it on the data, once for each
// shape of window (flat, wide, tall). Per shape it prints the size of the map in pixels and counts:
//   discs that overlap; stems (the line from a system to the system it lies at) that cross each other;
//   stems that run over the disc of a third system; stems longer than 1.15 times the two radii, which
//   means the two discs do not touch. The first three should be 0. Entries of one disc cannot overlap:
//   each has a cell of its own.
import fs from 'node:fs';
import { normalize, homes, foundationsOf, reachFrom } from '../js/propagate.js';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
globalThis.window = globalThis;
const d3 = new Function(`${read('js/vendor/d3.min.js')};return d3`)();
const nodes = normalize(JSON.parse(read('data/index.json')).areas.flatMap((a) => JSON.parse(read(`data/${a.file}`)).nodes));
const byId = new Map(nodes.map((n) => [n.id, n]));
const node = (id) => byId.get(id);
const home = homes(nodes);
const above = reachFrom(nodes, 'down', foundationsOf);
// The part of the page's `state` and of each entry that layoutClusters reads.
const state = { nodes, around: new Map(nodes.map((n) => [n.id, []])) };
nodes.forEach((n, i) => {
  n.i = i;
  n.home = home.get(n.id);
  n.above = above(n.id);
  if (n.home) state.around.get(n.home).push(n.id);
});

const app = read('js/app.js');
const from = app.indexOf('function layoutClusters(');
const to = app.indexOf('\n}\n', from);
if (from < 0 || !app.slice(from, to).includes('return pos;')) throw new Error('layoutClusters not found in js/app.js, or it no longer ends with "return pos;"');
// Besides the positions, hand out the discs where they ended up and the stems between them.
const body = app.slice(from, to).replace(/return pos;\s*$/, 'all.forEach((d, j) => ([d.x, d.y] = best.at[j]));\n  return { pos, discs: all, links };') + '\n}';
const layoutClusters = new Function('state', 'node', 'd3', `${body}; return layoutClusters;`)(state, node, d3);

const name = (d) => node(d.id).short;
const stem = (l) => `${name(l.source)}–${name(l.target)}`;
const side = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
for (const shape of ['flat', 'wide', 'tall']) {
  const { pos, discs, links } = layoutClusters(shape);
  const span = (k) => Math.max(...[...pos.values()].map((p) => p[k])) - Math.min(...[...pos.values()].map((p) => p[k]));
  const overlapping = [];
  discs.forEach((a, i) => discs.slice(i + 1).forEach((b) => a.r + b.r - Math.hypot(a.x - b.x, a.y - b.y) > 0.05 && overlapping.push(`${name(a)} and ${name(b)}`)));
  const crossing = [];
  links.forEach((p, i) =>
    links.slice(i + 1).forEach((q) => {
      const [a, b, c, d] = [p.source, p.target, q.source, q.target];
      if (new Set([a, b, c, d]).size === 4 && side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b)) crossing.push(`${stem(p)} and ${stem(q)}`);
    }),
  );
  const over = [];
  for (const l of links) {
    for (const d of discs) {
      if (d === l.source || d === l.target) continue;
      const [ax, ay, bx, by] = [l.source.x, l.source.y, l.target.x, l.target.y];
      const t = Math.max(0, Math.min(1, ((d.x - ax) * (bx - ax) + (d.y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
      if (Math.hypot(ax + t * (bx - ax) - d.x, ay + t * (by - ay) - d.y) < 0.8 * d.r) over.push(`${stem(l)} over ${name(d)}`);
    }
  }
  const long = links.map((l) => [stem(l), Math.hypot(l.source.x - l.target.x, l.source.y - l.target.y) / (l.source.r + l.target.r)]).filter(([, s]) => s > 1.15);
  console.log(`${shape}: ${pos.size} entries in ${discs.length} discs, ${Math.round(span(0))} x ${Math.round(span(1))} px`);
  console.log(`  overlapping discs: ${overlapping.length} ${overlapping.join(', ')}`);
  console.log(`  crossing stems: ${crossing.length} ${crossing.join(', ')}`);
  console.log(`  stems over a third system: ${over.length} ${over.join(', ')}`);
  console.log(`  stretched stems: ${long.length} of ${links.length} ${long.map(([s, x]) => `${s} ${x.toFixed(2)}`).join(', ')}`);
}
