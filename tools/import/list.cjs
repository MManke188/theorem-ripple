// Step 1 of the bulk import: the list of statements to add.
//
// Asks Wikidata (the database behind Wikipedia's infoboxes) for everything it
// classes as a theorem, conjecture, lemma, mathematical problem or axiom that
// has an English Wikipedia article (subclasses included, except for "problem",
// whose subclasses reach as far as Sudoku), and writes .import/candidates.json:
//   { qid, title (the Wikipedia article), label, classes, sitelinks, existing }
// `sitelinks` is the number of language editions with an article, used as a
// rough measure of how well known a statement is. `existing` is the id of the
// entry already on the map, when its `url` is that article or its name matches.
//
// Usage: node tools/import/list.cjs          (no tokens, about ten seconds)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const out = path.join(root, '.import');
const UA = { 'User-Agent': 'theorem-map-import/1.0 (node fetch)' };
const CLASSES = { theorem: 'Q65943', conjecture: 'Q319141', lemma: 'Q207505', problem: 'Q1166625', axiom: 'Q17736' };

const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]s\b/g, '').replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function sparql(query) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query), { headers: UA });
    if (res.ok) return (await res.json()).results.bindings;
    if (attempt === 3) throw new Error(`Wikidata answered ${res.status}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}

(async () => {
  const found = new Map();
  for (const [name, qid] of Object.entries(CLASSES)) {
    const rows = await sparql(`SELECT ?i ?iLabel ?title ?links WHERE {
      ?i ${name === 'problem' ? 'wdt:P31' : 'wdt:P31/wdt:P279*'} wd:${qid} ; wikibase:sitelinks ?links .
      ?a schema:about ?i ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?title .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" } }`);
    for (const r of rows) {
      const id = r.i.value.split('/').pop();
      const c = found.get(id) || { qid: id, title: r.title.value, label: r.iLabel.value, classes: [], sitelinks: +r.links.value };
      if (!c.classes.includes(name)) c.classes.push(name);
      found.set(id, c);
    }
    console.log(name, rows.length);
  }

  // Entries already on the map, by the Wikipedia article they cite and by name.
  const index = JSON.parse(fs.readFileSync(path.join(root, 'data', 'index.json'), 'utf8'));
  const byTitle = new Map();
  const byName = new Map();
  for (const a of index.areas) {
    for (const n of JSON.parse(fs.readFileSync(path.join(root, 'data', a.file), 'utf8')).nodes) {
      const m = /^https:\/\/en\.wikipedia\.org\/wiki\/([^#]+)$/.exec(n.url || '');
      if (m) byTitle.set(decodeURIComponent(m[1]).replace(/_/g, ' '), n.id);
      byName.set(norm(n.name), n.id);
    }
  }
  const list = [...found.values()].sort((a, b) => b.sitelinks - a.sitelinks || a.title.localeCompare(b.title));
  for (const c of list) c.existing = byTitle.get(c.title) || byName.get(norm(c.title)) || byName.get(norm(c.label)) || null;

  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'candidates.json'), JSON.stringify(list, null, 1));
  console.log(`${list.length} statements with an English article, ${list.filter((c) => c.existing).length} of them already on the map`);
})();
