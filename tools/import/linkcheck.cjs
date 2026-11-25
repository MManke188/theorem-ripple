// Step 6 of the bulk import: a second look at every dependency links.cjs reported.
//
// links.cjs reads one sentence at a time and reports too much. In the pilot,
// three browsing checkers graded only 29 of its 47 dependencies as fully
// right. The others were true for a variant of the statement, for a worked
// example, for one unusual derivation among several proofs, or pointed the
// wrong way. Here a stronger model sees the paragraph around the sentence and
// the heading of its section, and keeps a link only if it holds up. It may use
// what it knows about the mathematics to reject or turn round a link, never to
// add one. Results go to .import/<out>/<qid>.json; the links kept have "keep": true.
//
// Usage: node tools/import/linkcheck.cjs <pilot|all> <model> <links folder> [out folder, default links-checked]
const fs = require('fs');
const path = require('path');
const { pieces } = require('./pieces.cjs');
const { ask, pool, dir } = require('./model.cjs');

const SYSTEM = `You check dependency links for a public map of mathematical statements. An arrow from A to B on the map means "B rests on A": a proof of B uses A, or B follows from A, or (for an unproven B) B would be proven if A were. A first reader proposed each link from one sentence of a Wikipedia article and proposed too many. You see the claim, the sentence, the paragraph around it and the heading of its section. Keep only links that hold up.

The input is a JSON list of { i, article, other, claim, section, sentence, paragraph }. "article" is the statement the Wikipedia article is about; "the theorem", "it", "this result" in the text usually mean that one.

Answer "keep" only if the text says that the upper statement itself is proved using the lower statement itself, or follows from it, is a corollary of it or is implied by it, and the direction of the claim is right.

Answer "drop" if any of these holds:
- variant: the dependency is on, or of, a variant, a generalization, a special case or an analogue, and not the named statement itself (for example "a version of the inverse function theorem in algebraic geometry", "third-power versions of the lemma", "implies the conjecture in the special case where ...").
- aside: the lower statement is used in an example, a computation, an application or a side result, in setting up the statement, or in a related argument, and not in a proof of the upper statement.
- unusual route: the text derives the upper statement from the lower one, but the upper statement is an older or more basic result that is normally proved without it, so that the link would put a basic result on top of an advanced one (for example deriving the Plancherel theorem from the Stone–von Neumann theorem). A proof the article presents as its proof, or as the original or standard one, is not an unusual route, even if other proofs exist.
- mention: the text does not say this at all, or only names the other statement.

Answer "reverse" if the text states the dependency in the opposite direction to the claim (for example the claim says X rests on Y, and the text says "X is used to prove Y" or "Y is a consequence of X").

For a claim that two statements are equivalent: "keep" only if the text says that each implies the other, for the statements themselves.

You may use what you know about the mathematics to drop or reverse a link. Never keep a link because you know it to be true: it has to be in the text.

Answer with a JSON list and nothing else, one object per item in the same order: {"i": number, "verdict": "keep" | "drop" | "reverse", "why": at most fifteen words}.`;

const says = (l, article) => (l.relation === 'equivalent' ? `"${article}" and "${l.other}" are equivalent` : l.relation === 'article-needs-other' ? `"${article}" rests on "${l.other}"` : `"${l.other}" rests on "${article}"`);

(async () => {
  const [mode, model, from, folder = 'links-checked'] = process.argv.slice(2);
  if (!from) throw new Error('usage: linkcheck.cjs <pilot|all> <model> <links folder> [out folder]');
  const out = path.join(dir, folder);
  fs.mkdirSync(out, { recursive: true });
  const want = mode === 'pilot' ? new Set(JSON.parse(fs.readFileSync(path.join(dir, 'pilot.json'), 'utf8'))) : null;
  const todo = fs.readdirSync(path.join(dir, from)).map((f) => f.replace('.json', '')).filter((q) => (!want || want.has(q)) && !fs.existsSync(path.join(out, `${q}.json`)));

  const items = [];
  for (const qid of todo) {
    const links = JSON.parse(fs.readFileSync(path.join(dir, from, `${qid}.json`), 'utf8')).filter((l) => ['article-needs-other', 'other-needs-article', 'equivalent'].includes(l.relation));
    if (!links.length) {
      fs.writeFileSync(path.join(out, `${qid}.json`), '[]');
      continue;
    }
    const p = pieces(qid);
    for (const l of links) {
      const m = p.mentions.find((x) => x.target === l.target && x.sentence === l.sentence) || p.mentions.find((x) => x.target === l.target);
      items.push({ qid, link: l, article: p.title, section: m?.section || 'Introduction', paragraph: m?.paragraph || l.sentence });
    }
  }
  const batches = [];
  for (let i = 0; i < items.length; i += 25) batches.push(items.slice(i, i + 25));
  console.log(`${items.length} links from ${todo.length} articles in ${batches.length} calls to ${model}`);

  const results = new Map();
  await pool(batches, 3, async (batch, n) => {
    const user = JSON.stringify(batch.map((x, i) => ({ i, article: x.article, other: x.link.other, claim: says(x.link, x.article), section: x.section, sentence: x.link.sentence, paragraph: x.paragraph })));
    const answer = await ask({ step: 'linkcheck', model, system: SYSTEM, user, items: batch.length });
    batch.forEach((x, i) => {
      const a = answer.find((r) => r.i === i) || { verdict: 'drop', why: 'no answer' };
      const flip = { 'article-needs-other': 'other-needs-article', 'other-needs-article': 'article-needs-other' };
      const relation = a.verdict === 'reverse' ? flip[x.link.relation] : x.link.relation;
      const list = results.get(x.qid) || [];
      list.push({ ...x.link, relation, keep: a.verdict === 'keep' || (a.verdict === 'reverse' && !!relation), verdict: a.verdict, checkWhy: a.why, claim: says({ ...x.link, relation: relation || x.link.relation }, x.article) });
      results.set(x.qid, list);
    });
    console.log(`call ${n + 1} of ${batches.length} done`);
  });
  for (const [qid, list] of results) fs.writeFileSync(path.join(out, `${qid}.json`), JSON.stringify(list, null, 1));
})();
