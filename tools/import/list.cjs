// Step 1 of the bulk import: the list of statements to add.
//
// Asks Wikidata (the database behind Wikipedia's infoboxes) for everything it
// classes as a theorem, conjecture, lemma, mathematical problem or axiom that
// has an English Wikipedia article (subclasses included, except for "problem",
// whose subclasses reach as far as Sudoku), and writes .import/candidates.json:
//   { qid, title (the Wikipedia article), label, classes, sitelinks, existing }
// `sitelinks` is the number of language editions with an article, used as a
// rough measure of how well known a statement is. `existing` is the id of the
// entry written by hand that is the article's statement (see `match` below).
//
// Usage: node tools/import/list.cjs            (no tokens, about ten seconds)
//        node tools/import/list.cjs --rematch  only works out `existing` again for the list already there
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const out = path.join(root, '.import');
const UA = { 'User-Agent': 'theorem-map-import/1.0 (node fetch)' };
const CLASSES = { theorem: 'Q65943', conjecture: 'Q319141', lemma: 'Q207505', problem: 'Q1166625', axiom: 'Q17736' };

// Articles where neither the name nor the citing entry settles it: which entry the article is, or null for none.
// An entry that cites an article is often a special case of it or a result proven under it, not the statement itself.
const ARTICLE = {
  "Goldbach's weak conjecture": 'ternary-goldbach', // also cited by Vinogradov's theorem, which is the weaker "every large enough odd number"
  'Time hierarchy theorem': 'time-hierarchy', // also cited by "P is strictly contained in EXPTIME", a consequence
  'Ramanujan–Petersson conjecture': 'generalized-ramanujan', // also cited by Deligne's theorem for the tau function, the proven case
  'Generalized Poincaré conjecture': null, // the entries that cite it are single dimensions
  'Jacobian conjecture': null, // on the map only for two variables
  'Dixmier conjecture': null, // on the map only for the first Weyl algebra
  'Grand Riemann hypothesis': null, // on the map only for L-functions of modular forms
  "Linnik's theorem": null, // the entry that cites it is a sharper bound proven under a hypothesis
};

const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]s\b/g, '').replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function sparql(query) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query), { headers: UA });
    if (res.ok) return (await res.json()).results.bindings;
    if (attempt === 3) throw new Error(`Wikidata answered ${res.status}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}

// Which entry written by hand an article is. The entry that bears the article's name comes first: several entries
// may cite one article (the continuum hypothesis and the theorem that it is independent), and taking whichever
// cited it put links on the wrong entry. Imported entries are left out, they came from this list.
function matcher() {
  const index = JSON.parse(fs.readFileSync(path.join(root, 'data', 'index.json'), 'utf8'));
  const citing = new Map(); // article title -> ids of the entries that cite it
  const byName = new Map();
  for (const a of index.areas) {
    for (const n of JSON.parse(fs.readFileSync(path.join(root, 'data', a.file), 'utf8')).nodes) {
      if (n.origin === 'wikipedia-import') continue;
      const m = /^https:\/\/en\.wikipedia\.org\/wiki\/([^#]+)$/.exec(n.url || '');
      if (m) {
        const title = decodeURIComponent(m[1]).replace(/_/g, ' ');
        citing.set(title, [...(citing.get(title) || []), n.id]);
      }
      byName.set(norm(n.name), n.id);
    }
  }
  return (c) => {
    if (c.title in ARTICLE) return ARTICLE[c.title];
    const named = byName.get(norm(c.title)) || byName.get(norm(c.label));
    if (named) return named;
    const cited = citing.get(c.title) || [];
    if (cited.length > 1) console.log(`unclear: "${c.title}" is cited by ${cited.join(', ')} and none bears its name. Add it to ARTICLE.`);
    return cited.length === 1 ? cited[0] : null;
  };
}

(async () => {
  if (process.argv.includes('--rematch')) {
    const file = path.join(out, 'candidates.json');
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    const match = matcher();
    for (const c of list) {
      const now = match(c);
      if (now !== c.existing) console.log(`${c.title}: ${c.existing} -> ${now}`);
      c.existing = now;
    }
    fs.writeFileSync(file, JSON.stringify(list, null, 1));
    return;
  }
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

  const list = [...found.values()].sort((a, b) => b.sitelinks - a.sitelinks || a.title.localeCompare(b.title));
  const match = matcher();
  for (const c of list) c.existing = match(c);

  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'candidates.json'), JSON.stringify(list, null, 1));
  console.log(`${list.length} statements with an English article, ${list.filter((c) => c.existing).length} of them already on the map`);
})();
