// Step 4 of the bulk import: which statements rest on which.
//
// pieces.cjs finds every sentence in an article that links to another
// statement on the list. Here a model reads those sentences, a pair of
// statements at a time, and says what they state about the pair: that one
// rests on the other, that the two are equivalent, that they are merely
// related, or nothing. It sees only the sentences, so a link it reports
// always comes with the sentence that states it; the article is its source.
// Results go to .import/<out>/<qid>.json, one file per article.
//
// Usage: node tools/import/links.cjs <pilot|all> <model> [out folder, default links-<model>]
const fs = require('fs');
const path = require('path');
const { pieces } = require('./pieces.cjs');
const { ask, pool, dir } = require('./model.cjs');

const SYSTEM = `You read sentences from Wikipedia articles about mathematical statements and report what each group of sentences says about how two statements depend on each other. The result is drawn on a public map where an arrow from A to B means "B rests on A".

The input is a JSON list. Each item has: i (its number), article (the statement the article is about; "the theorem", "the conjecture", "it" in a sentence usually mean this one), other (another statement, which the sentences link to), and sentences (taken from the article, each with the heading of its section).

Judge only what the sentences say. Do not use what you know about the mathematics: a dependency that is true but not stated in these sentences is "none". For each item answer with one of:

- "article-needs-other": the sentences say that the proof of the article's statement uses the other statement, or that the article's statement is derived from it, follows from it, is a corollary or consequence of it, or holds if the other statement is true (for example "assuming the Riemann hypothesis, ...").
- "other-needs-article": the same in the opposite direction: the other statement is proved using the article's statement, follows from it, is a corollary of it, or is implied by it.
- "equivalent": the sentences say the two statements are equivalent (each implies the other).
- "related": the sentences say one generalizes the other, is a special case, an analogue, a converse, a strengthening or a variant of it, or that they belong to one family, without saying that one is proved from the other. "A is a special case of B" alone is "related": it does not say how A is proved.
- "none": the other statement is only mentioned (in a list, a comparison, an example, a history of who worked on what), or the sentences are about something else, or you cannot tell.

When a sentence says both that A is a special case of B and that A is used to prove B, the answer is the dependency (B needs A).

Answer with a JSON list and nothing else, one object per item in the same order: {"i": number, "relation": one of the five, "sentence": the number (starting at 0) of the sentence that says so, "why": at most twelve words}. For "none" leave out "sentence".`;

(async () => {
  const [mode, model, folder = `links-${model}`] = process.argv.slice(2);
  if (!model) throw new Error('usage: links.cjs <pilot|all> <model> [out folder]');
  const out = path.join(dir, folder);
  fs.mkdirSync(out, { recursive: true });
  const all = JSON.parse(fs.readFileSync(path.join(dir, 'candidates.json'), 'utf8'));
  const want = mode === 'pilot' ? new Set(JSON.parse(fs.readFileSync(path.join(dir, 'pilot.json'), 'utf8'))) : null;
  const todo = all.filter((c) => (!want || want.has(c.qid)) && fs.existsSync(path.join(dir, 'pages', `${c.qid}.json`)) && !fs.existsSync(path.join(out, `${c.qid}.json`)));

  // One item per pair of statements, with up to four sentences.
  const items = [];
  for (const c of todo) {
    const pairs = new Map();
    for (const m of pieces(c.qid).mentions) {
      const p = pairs.get(m.target) || { qid: c.qid, article: c.title, target: m.target, other: m.title, existing: m.existing, sentences: [] };
      if (p.sentences.length < 4) p.sentences.push({ section: m.section || 'Introduction', text: m.sentence });
      pairs.set(m.target, p);
    }
    items.push(...pairs.values());
    if (!pairs.size) fs.writeFileSync(path.join(out, `${c.qid}.json`), '[]');
  }
  const batches = [];
  for (let i = 0; i < items.length; i += 40) batches.push(items.slice(i, i + 40));
  console.log(`${items.length} pairs from ${todo.length} articles in ${batches.length} calls to ${model}`);

  const results = new Map();
  await pool(batches, 3, async (batch, n) => {
    const user = JSON.stringify(batch.map((p, i) => ({ i, article: p.article, other: p.other, sentences: p.sentences })));
    const answer = await ask({ step: 'links', model, system: SYSTEM, user, items: batch.length });
    batch.forEach((p, i) => {
      const a = answer.find((x) => x.i === i) || { relation: 'none', why: 'no answer' };
      const list = results.get(p.qid) || [];
      list.push({ target: p.target, other: p.other, existing: p.existing, relation: a.relation, why: a.why, sentence: p.sentences[a.sentence ?? 0]?.text, sentences: p.sentences.length });
      results.set(p.qid, list);
    });
    console.log(`call ${n + 1} of ${batches.length} done`);
  });
  for (const [qid, list] of results) fs.writeFileSync(path.join(out, `${qid}.json`), JSON.stringify(list, null, 1));
})();
