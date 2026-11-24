// Step 5 of the bulk import: a second, stronger model reviews every draft
// against the whole article.
//
// The writer (write.cjs) saw only the opening and two sections. In the pilot
// that left 4 of 65 statements false, each time because a condition stood in a
// later section, and 3 articles were wrongly set aside as "unclear". The
// reviewer sees the whole article (up to a length limit) next to the draft,
// corrects it and says what it changed. It still may not add facts from
// memory; where it thinks the article itself is wrong or incomplete it leaves
// the entry alone and says so in `doubt`. Those entries go to a checker that
// can browse.
//
// Usage: node tools/import/review.cjs <pilot|all> <model> <drafts folder> [out folder, default reviewed]
//   e.g. node tools/import/review.cjs pilot opus drafts-sonnet
const fs = require('fs');
const path = require('path');
const { pieces } = require('./pieces.cjs');
const { ask, pool, dir } = require('./model.cjs');
const { FIELDS, SYSTEMS, problems } = require('./write.cjs');

const SYSTEM = `You review draft entries for a public map of mathematical statements. The map shows which statements rest on which; its readers are curious non-specialists. Another model wrote each draft from the opening of a Wikipedia article and one or two of its sections. You are given the whole article (formulas in LaTeX between $ signs) and the draft. Find what is wrong with the draft and return the corrected entry. In an independent check, one draft statement in fifteen was false because it left out a condition that the article gives further down.

The input is a JSON list of { qid, title, article, draft }. Answer with a JSON list holding one object per item, in the same order, and nothing else: no markdown fence, no comments.

What to check:
1. The verdict. "statement" is right when the article is about one precise mathematical statement: a theorem, lemma, identity, formula, inequality, conjecture, hypothesis, axiom, or an open problem that asks whether one precise statement is true. If the draft says "skip" or "unclear" but the article does state one such claim precisely somewhere, write the entry. If the draft is an entry but the article is about something else (a puzzle, a task or algorithm, a broad topic, several different theorems, an informal or empirical law, a physical law or a result that holds only under physical assumptions, a conjecture that was disproved), set verdict "skip" with a reason. Where an article covers one main theorem with variants, the entry is the main theorem.
2. The statement, against every place where the article states the claim or qualifies it: the formal statement, and later sections that add conditions, exceptions or counterexamples. Add every condition without which the statement is false (finiteness, sign or positivity conditions, real or complex coefficients, "every" against "some", "at most" against "exactly"). Check quantifiers, constants and the direction of inequalities symbol by symbol against the formulas.
3. "by", "year" and "settled": who stated it or proved it and when, wherever the article says, not only whom it is named after. A year must stand in the article.
4. "kind" and "base": proven, open or assumed, as the article says.
5. "within": the most specific fitting systems from the list, or an empty list when none fits.
6. "note": true to the article, and written as a plain fact (not "the text says").

Facts come only from the article: add no name, year or claim from memory. Do use your knowledge of mathematics to judge whether the statement can be true as written. If you believe the article itself is incomplete or mistaken about the claim, do not repair it from memory: keep the entry as the article has it and add "doubt" with one sentence saying what you believe is wrong.

Return for each item:
- "qid", "verdict" ("statement", "skip" or "unclear") and, for skip and unclear, "reason".
- for a statement: the complete final entry with the fields described below, whether or not you changed anything.
- "changed": a list with one short phrase per correction, for example "statement: added that the coefficients are real and the leading one positive". An empty list if the draft was right.
- "doubt": only as described above.

${FIELDS}

${SYSTEMS}`;

// The whole article where it is short; otherwise its opening, its formal statement and as much of the rest as fits.
function articleText(p, max = 16000) {
  if (p.text.length <= max) return p.text;
  const head = `${p.intro}\n\n${p.formal}\n\n${p.history}`;
  return `${head}\n\n[...]\n\n${p.text.slice(p.intro.length, p.intro.length + max - head.length)}`;
}

(async () => {
  const [mode, model, from, folder = 'reviewed'] = process.argv.slice(2);
  if (!from) throw new Error('usage: review.cjs <pilot|all> <model> <drafts folder> [out folder]');
  const out = path.join(dir, folder);
  fs.mkdirSync(out, { recursive: true });
  const want = mode === 'pilot' ? new Set(JSON.parse(fs.readFileSync(path.join(dir, 'pilot.json'), 'utf8'))) : null;
  const todo = fs.readdirSync(path.join(dir, from)).map((f) => f.replace('.json', '')).filter((q) => (!want || want.has(q)) && !fs.existsSync(path.join(out, `${q}.json`)));
  // Batches by length, so that a call holds about 60,000 characters of articles.
  const batches = [[]];
  let size = 0;
  for (const qid of todo) {
    const p = pieces(qid);
    const item = { qid, title: p.title, article: articleText(p), draft: JSON.parse(fs.readFileSync(path.join(dir, from, `${qid}.json`), 'utf8')) };
    for (const k of ['problems', 'title', 'quotes']) delete item.draft[k];
    if (size + item.article.length > 60000 && batches.at(-1).length) {
      batches.push([]);
      size = 0;
    }
    batches.at(-1).push(item);
    size += item.article.length;
  }
  console.log(`${todo.length} drafts in ${batches.length} calls to ${model}`);

  await pool(batches, 3, async (batch, i) => {
    const answer = await ask({ step: 'review', model, system: SYSTEM, user: JSON.stringify(batch), items: batch.length });
    for (const item of batch) {
      const e = answer.find((a) => a.qid === item.qid);
      if (!e) {
        console.log('  no answer for', item.title);
        continue;
      }
      e.verdict ??= e.statement ? 'statement' : 'unclear';
      e.problems = problems(e, item.article);
      e.title = item.title;
      e.draftVerdict = item.draft.verdict;
      fs.writeFileSync(path.join(out, `${item.qid}.json`), JSON.stringify(e, null, 1));
    }
    console.log(`call ${i + 1} of ${batches.length} done`);
  });
})();
