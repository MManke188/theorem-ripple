// Step 2 of the bulk import: download the Wikipedia articles for the candidates.
//
// For each statement in .import/candidates.json this saves .import/pages/<qid>.json:
//   { title, wikitext (the article's source text), aliases (titles that redirect to it) }
// The source text is used, not the rendered page, for two reasons: formulas
// arrive as LaTeX, and 50 articles fit in one request. Wikipedia throttles a
// script to about ten requests a minute, so one article per request would take hours.
// Nothing is sent to a model here; pieces.cjs cuts out what the later steps need.
//
// Usage: node tools/import/fetch.cjs pilot 100   100 statements spread evenly from the best known
//                                                to the least known; their ids go to .import/pilot.json
//        node tools/import/fetch.cjs all         every candidate, including the ones already on the
//                                                map (their redirects are needed to recognise links)
// Articles already downloaded are skipped.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '..', '.import');
const pages = path.join(dir, 'pages');
const UA = { 'User-Agent': 'theorem-map-import/1.0 (node fetch)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = 'https://en.wikipedia.org/w/api.php?format=json&formatversion=2&';

async function get(params) {
  for (let attempt = 0; ; attempt++) {
    await sleep(1500);
    const res = await fetch(api + new URLSearchParams(params), { headers: UA });
    if (res.ok) return res.json();
    if (attempt === 8) throw new Error(`Wikipedia answered ${res.status}`);
    await sleep(1000 * (+res.headers.get('retry-after') || 10 * (attempt + 1))); // 429: asked to slow down
  }
}

(async () => {
  const [mode, count] = process.argv.slice(2);
  const all = JSON.parse(fs.readFileSync(path.join(dir, 'candidates.json'), 'utf8'));
  let todo = all;
  if (mode === 'pilot') {
    const fresh = all.filter((c) => !c.existing);
    const step = fresh.length / +count;
    todo = Array.from({ length: +count }, (_, i) => fresh[Math.floor(i * step + step / 2)]);
    fs.writeFileSync(path.join(dir, 'pilot.json'), JSON.stringify(todo.map((c) => c.qid)));
  } else if (mode !== 'all') {
    throw new Error('say "pilot <count>" or "all"');
  }
  fs.mkdirSync(pages, { recursive: true });
  todo = todo.filter((c) => !fs.existsSync(path.join(pages, `${c.qid}.json`)));
  let done = 0;
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50);
    const got = new Map(batch.map((c) => [c.title, { title: c.title, wikitext: '', aliases: [] }]));
    // The answer comes in several parts when it is long; `continue` asks for the next one.
    for (let more = {}; more; ) {
      const res = await get({ action: 'query', prop: 'revisions|redirects', rvprop: 'content', rvslots: 'main', rdlimit: 500, rdnamespace: 0, titles: batch.map((c) => c.title).join('|'), ...more });
      for (const p of res.query.pages) {
        const page = got.get(p.title);
        if (!page) continue;
        if (p.revisions) page.wikitext = p.revisions[0].slots.main.content;
        for (const r of p.redirects || []) page.aliases.push(r.title);
      }
      more = res.continue;
    }
    for (const c of batch) {
      if (!got.get(c.title).wikitext) console.log('no text for', c.title);
      else fs.writeFileSync(path.join(pages, `${c.qid}.json`), JSON.stringify(got.get(c.title)));
    }
    console.log((done += batch.length));
  }
  console.log(`downloaded ${done} articles`);
})();
