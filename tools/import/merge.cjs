// Last step of the bulk import: writes the reviewed entries and the checked
// links into the data files of the map.
//
// Reads  .import/reviewed/     entries after review.cjs
//        .import/placed.json   fields found later for entries the review could not place (place.cjs), optional
//        .import/links-checked/ links after linkcheck.cjs
//        .import/status.json   what a web search found about each open statement, optional:
//                              { qid: { status: "open" | "proven" | "disproved", claim?, url? } }
//                              An entry with a claim is left out: a claim has to be checked against its
//                              source and worded by hand before it goes on the page.
//        .import/exclude.json  qids or ids of entries, and links as "upper id>lower id", that a check found wrong, optional
//        .import/new-systems.json  fields to add to data/foundations.json, optional
// Writes the area files under <target>/data and adds new areas to index.json.
// Every imported entry carries origin: "wikipedia-import", so that it can be
// told apart from the entries researched one by one, and found again: running
// this twice replaces the earlier import instead of adding to it.
//
// Usage: node tools/import/merge.cjs [target folder, default the repository]
// Prints what it left out and why. Run `node --test` in the target afterwards.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const dir = path.join(root, '.import');
const target = path.resolve(process.argv[2] || root);
const data = path.join(target, 'data');
const read = (f, fallback) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : fallback);
const folder = (name) => (fs.existsSync(path.join(dir, name)) ? fs.readdirSync(path.join(dir, name)).map((f) => [f.replace('.json', ''), read(path.join(dir, name, f))]) : []);

// Which area of the map each field belongs to. A field missing here keeps its entries out.
const AREA = {
  'number-theory': ['elementary-number-theory', 'analytic-number-theory', 'algebraic-number-theory', 'arithmetic-geometry', 'natural-numbers', 'integers', 'rational-numbers'],
  complexity: ['complexity-theory', 'cryptography', 'computability-theory'],
  'algebra-geometry': ['group-theory', 'rings-and-fields', 'linear-algebra', 'galois-theory', 'algebraic-geometry', 'representation-theory', 'category-theory'],
  combinatorics: ['combinatorics', 'graph-theory', 'order-theory'],
  'analysis-topology': ['real-analysis', 'topology', 'measure-theory', 'complex-analysis', 'functional-analysis', 'harmonic-analysis', 'partial-differential-equations', 'differential-geometry', 'geometric-topology', 'real-numbers', 'complex-numbers', 'ordinary-differential-equations', 'dynamical-systems', 'algebraic-topology'],
  logic: ['mathematical-logic', 'descriptive-set-theory', 'zf-set-theory'],
  geometry: ['euclidean-geometry', 'projective-geometry'],
  probability: ['probability-theory', 'statistics', 'information-theory', 'game-theory'],
};
const NEW_AREAS = { geometry: 'Classical geometry', probability: 'Probability and statistics' };
const areaOf = (system) => Object.keys(AREA).find((a) => AREA[a].includes(system));

const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const wiki = (title) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
const left = {}; // reason -> names, for the report
const leave = (why, name) => (left[why] ??= []).push(name);

// ---- what is on the map already (without an earlier import)
const index = read(path.join(data, 'index.json'));
const files = new Map(index.areas.map((a) => [a.id, read(path.join(data, a.file))]));
for (const f of files.values()) f.nodes = f.nodes.filter((n) => n.origin !== 'wikipedia-import');
// Links an earlier import added to entries researched by hand carry the same mark.
for (const f of files.values()) for (const n of f.nodes) if (n.needs) n.needs = n.needs.filter((x) => x.origin !== 'wikipedia-import');
for (const sys of read(path.join(dir, 'new-systems.json'), [])) {
  const nodes = files.get('foundations').nodes;
  if (!nodes.some((n) => n.id === sys.id)) nodes.push(sys);
}
const byId = new Map([...files.values()].flatMap((f) => f.nodes).map((n) => [n.id, n]));
const systems = new Set([...byId.values()].filter((n) => n.kind === 'system').map((n) => n.id));

// ---- the entries
const candidates = new Map(read(path.join(dir, 'candidates.json')).map((c) => [c.qid, c]));
const placed = read(path.join(dir, 'placed.json'), {});
const status = read(path.join(dir, 'status.json'), {});
const exclude = new Set(read(path.join(dir, 'exclude.json'), [])); // qids or ids of entries, and links as "upper id>lower id", that a check found wrong
const idOf = new Map([...candidates.values()].filter((c) => c.existing).map((c) => [c.qid, c.existing])); // qid -> id on the map
const fresh = new Map(); // qid -> entry
for (const [qid, e] of folder('reviewed')) {
  if (e.verdict !== 'statement') continue;
  const name = e.name || e.title;
  if (exclude.has(qid) || exclude.has(slug(name))) { leave('found wrong by a check', name); continue; }
  if (e.problems?.some((p) => !p.startsWith('short is longer'))) { leave('failed a mechanical check (quote or year not in the article)', name); continue; }
  const found = status[qid];
  if (e.base === 'open' && e.kind === 'hypothesis' && !found) { leave('open statement without a status search', name); continue; }
  if (found?.claim) { leave('open statement with a claimed proof or disproof that nobody has checked against its source yet', name); continue; }
  if (found?.status === 'disproved') { leave('disproved, says the status search', name); continue; }
  if (found?.status === 'proven') { leave('proven since, says the status search: needs an entry written by hand', name); continue; }
  const within = (e.within?.length ? e.within : placed[qid] || []).filter((s) => systems.has(s) && areaOf(s));
  if (!within.length && e.kind !== 'axiom') { leave('no field on the map to stand on', name); continue; }
  let id = slug(name);
  if (!id) { leave('no usable name', e.title); continue; }
  if (byId.has(id) || [...fresh.values()].some((x) => x.id === id)) id = `${id}-${qid.toLowerCase()}`;
  const short = e.short && e.short.length <= 26 ? e.short : name.length <= 26 ? name : null;
  if (!short) { leave('no label of 26 characters or fewer', name); continue; }
  const c = candidates.get(qid);
  const entry = { id, name, short, statement: e.statement, kind: e.kind, base: e.base, needs: [] };
  if (e.kind !== 'axiom') entry.within = within.slice(0, 2);
  for (const k of ['by', 'note']) if (e[k]) entry[k] = e[k];
  entry.url = wiki(c.title);
  entry.area = e.kind === 'axiom' ? 'logic' : areaOf(within[0]);
  // Years as the tests want them; a pair that cannot be right (proved before it was stated) is left out, not guessed.
  const sane = (y) => Number.isInteger(y) && y >= -600 && y !== 0 && y <= new Date().getFullYear();
  if (sane(e.year)) entry.year = e.year;
  if (sane(e.settled) && e.base === 'proven' && sane(e.year)) {
    if (e.settled > e.year) entry.settled = e.settled;
    else delete entry.year;
  }
  if (e.doubt) entry.doubt = e.doubt; // taken out again below; such entries wait for a browsing check
  entry.origin = 'wikipedia-import';
  fresh.set(qid, entry);
  idOf.set(qid, id);
}
// Where the reviewer believes Wikipedia itself is wrong or incomplete, the entry waits.
for (const [qid, e] of fresh) {
  if (!e.doubt) continue;
  leave('the reviewer doubts the article: needs a browsing check', e.name);
  fresh.delete(qid);
  idOf.delete(qid);
}
for (const e of fresh.values()) byId.set(e.id, e);

// ---- the links
const settled = (n) => n.base === 'proven'; // an axiom, also one assumed by default, is not: what rests on it is conditional
const needsOf = (n) => (n.needs || []).map((x) => (typeof x === 'string' ? x : x.id));
const below = (n) => [...needsOf(n), ...(n.anyOf || []).map((x) => (typeof x === 'string' ? x : x.id)), ...(n.within || []).map((x) => (typeof x === 'string' ? x : x.id))];
const reaches = (from, to, seen = new Set()) => from === to || below(byId.get(from)).some((id) => !seen.has(id) && seen.add(id) && reaches(id, to, seen));
let added = 0;
for (const [qid, list] of folder('links-checked')) {
  for (const l of list) {
    if (!l.keep || l.relation === 'equivalent') continue;
    const [upQ, downQ] = l.relation === 'article-needs-other' ? [qid, l.target] : [l.target, qid];
    const [up, down] = [byId.get(idOf.get(upQ)), byId.get(idOf.get(downQ))];
    const words = `${candidates.get(upQ)?.title} rests on ${candidates.get(downQ)?.title}`;
    if (!up || !down) { leave('link to a statement that is not on the map', words); continue; }
    if (up.kind === 'system' || down.kind === 'system' || needsOf(up).includes(down.id)) continue;
    if (exclude.has(`${up.id}>${down.id}`)) { leave('found wrong by a check', words); continue; }
    // A proven result may only rest on what holds; an open one only on what is open (see tools/research-brief.md).
    if (up.base === 'proven' && !settled(down)) { leave('link would make a proven result rest on an unproven one', words); continue; }
    if (up.base !== 'proven' && settled(down)) { leave('link from an open or conditional statement to a proven one', words); continue; }
    if (up.base === 'conditional') { leave('link into a conditional result researched by hand', words); continue; }
    if (reaches(down.id, up.id)) { leave('link would close a circle', words); continue; }
    const source = wiki(candidates.get(qid).title);
    up.needs.push(up.origin ? (source === up.url ? down.id : { id: down.id, url: source }) : { id: down.id, url: source, origin: 'wikipedia-import' });
    added++;
  }
}
// A statement that rests on other statements has its place through them; `within` is for the others.
for (const e of fresh.values()) if (e.needs.some((x) => byId.get(typeof x === 'string' ? x : x.id).kind !== 'axiom')) delete e.within;
// An axiom has no field; without a link it would stand alone on the map.
const linked = new Set([...byId.values()].flatMap(needsOf));
for (const [qid, e] of fresh) {
  if (e.kind === 'axiom' && !linked.has(e.id) && !e.needs.length) {
    leave('axiom that nothing on the map is linked to', e.name);
    fresh.delete(qid);
    byId.delete(e.id);
  }
}

// ---- write
for (const [id, name] of Object.entries(NEW_AREAS)) {
  if (!files.has(id) && [...fresh.values()].some((e) => e.area === id)) {
    files.set(id, { area: id, nodes: [] });
    index.areas.push({ id, name, file: `${id}.json` });
  }
}
for (const e of fresh.values()) files.get(e.area).nodes.push(e);
for (const a of index.areas) fs.writeFileSync(path.join(data, a.file), JSON.stringify(files.get(a.id), null, 2) + '\n');
fs.writeFileSync(path.join(data, 'index.json'), JSON.stringify(index, null, 2) + '\n');

console.log(`${fresh.size} entries and ${added} links written to ${data}`);
for (const [why, names] of Object.entries(left)) console.log(`left out, ${why}: ${names.length}\n   ${names.slice(0, 6).join('; ')}${names.length > 6 ? '; ...' : ''}`);
fs.writeFileSync(path.join(dir, 'left-out.json'), JSON.stringify(left, null, 1));
