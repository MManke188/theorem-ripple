// Step 3 of the bulk import: a model writes one draft entry per article.
//
// The model sees only the opening of the article, the start of the section that
// states the claim, and the start of its History section (cut out by pieces.cjs). It may not browse and is told to add
// nothing from memory. With every entry it returns the sentences it took the
// statement, the attribution and the status from; this script then checks by
// plain text comparison that those sentences really are in the article, and
// notes what is wrong in `problems`. Drafts go to .import/<out>/<qid>.json.
//
// Usage: node tools/import/write.cjs <pilot|all> <model> [out folder, default drafts-<model>]
//   e.g. node tools/import/write.cjs pilot haiku
// Articles that already have a draft in the folder are skipped.
const fs = require('fs');
const path = require('path');
const { pieces } = require('./pieces.cjs');
const { ask, pool, dir } = require('./model.cjs');

const root = path.join(__dirname, '..', '..');
const systems = JSON.parse(fs.readFileSync(path.join(root, 'data', 'foundations.json'), 'utf8')).nodes.filter((n) => n.kind === 'system');

// What an entry holds. Shared with review.cjs, which returns entries in the same form.
const FIELDS = `For a "statement" return:
- "qid": as given.
- "name": the full name as a mathematician would say it. Usually the article title without a bracketed addition.
- "short": a label for the map, at most 26 characters.
- "statement": what it claims, in one or two plain declarative sentences. Keep every condition the text gives (continuous, finite, compact, n ≥ 3, sufficiently large, and so on): a statement that drops a condition is false. Use Unicode symbols (≤, ∑, π, ², ℝ), never LaTeX. Where it is possible without losing accuracy, word it so that someone with school mathematics can follow. Say what is claimed, not what the statement is about or why it matters.
- "kind": "theorem" for a proven result (also a lemma, identity, formula or inequality), "hypothesis" for a conjecture or an open problem, "axiom" for an axiom or postulate that is assumed and not proven.
- "base": "proven" or "open". A conjecture that the text says has been proved is kind "theorem", base "proven". Hypotheses and axioms are "open".
- "by": who and when, in the words the text supports, for example "Augustin-Louis Cauchy, 1823" or "Named after Michel Rolle, 1691; first proved in general by Cauchy, 1823". Say who stated or proved it wherever the text does; "Named after ..." alone is only for a text that says nothing more. Leave out if the text names nobody.
- "year": the year it was first stated or first proven, whichever came first, as a number (before the common era: negative). Leave out if the text gives none. Do not turn "12th century" into a year.
- "settled": only for a statement that began as a conjecture and was proved later: the year it was proved.
- "field": the branch or branches of mathematics the text places it in, in the text's own words, for example "calculus and real analysis".
- "within": the ids of one or at most two systems from the list below that the field corresponds to, the most specific first. An empty list if none of them fits; do not force a fit.
- "note": optional. One or two plain sentences of context taken from the text: what it is used for or how it relates to something else.
- "quotes": an object with the passages you relied on, copied character for character from the text, each at most 300 characters: "statement" (required), "by" (if you gave by or year), "status" (if the text says it is proven, open or assumed).

Wording: plain declarative sentences, no hype, no rhetorical questions, no dashes used as punctuation (hyphenated names such as "Green–Tao" are fine).`;
const SYSTEMS = `Systems for "within":
${systems.map((s) => `- ${s.id}: ${s.name}`).join('\n')}`;

const SYSTEM = `You turn the opening of Wikipedia articles into entries for a public map of mathematical statements. The map shows which statements rest on which. Its readers are curious non-specialists.

The input is a JSON list of articles: qid, title, intro (the opening of the article), and where the article has them formal (the start of the section that states the claim precisely) and history (the start of its History section). Formulas are written in LaTeX between $ signs. Answer with a JSON list holding one object per article, in the same order, and nothing else: no markdown fence, no comments.

The rule that matters most: work only from the text you are given. Do not add anything from memory, even where you are sure of it: no names, no years, no hypotheses, no status. Earlier entries written from memory were wrong in detail four times out of ten. Where the text does not say something, leave that field out.

For each article first set "verdict":
- "statement": the article is about one precise mathematical statement: a theorem, lemma, identity, formula, inequality, conjecture, hypothesis, axiom, or an open problem that asks whether one precise statement is true. Statements of statistics, computer science, economics or mathematical physics count only when they are theorems with a mathematical proof; a physical law or a result that holds under physical assumptions is "skip".
- "skip": anything else: a puzzle, a computational task or algorithm, a broad topic, a programme, a list of several different statements, a paradox, an empirical or informal law, a conjecture the text says was disproved. Give "reason" in a few words.
- "unclear": it is one statement, but the text does not say precisely enough what it claims for you to state it faithfully. Give "reason".
For "skip" and "unclear" return only qid, verdict and reason. Every object has a verdict.

${FIELDS}

${SYSTEMS}`;

const flat = (s) => s.replace(/\s+/g, ' ').trim();

// What can be checked without a model.
function problems(e, source) {
  const out = [];
  if (e.verdict !== 'statement') return out;
  for (const k of ['name', 'short', 'statement', 'kind', 'base', 'quotes']) if (!e[k]) out.push(`no ${k}`);
  if ((e.short || '').length > 26) out.push('short is longer than 26 characters');
  if (!['theorem', 'hypothesis', 'axiom'].includes(e.kind)) out.push(`kind ${e.kind}`);
  if ((e.kind === 'theorem') !== (e.base === 'proven')) out.push(`kind ${e.kind} with base ${e.base}`);
  for (const id of e.within || []) if (!systems.some((s) => s.id === id)) out.push(`unknown system ${id}`);
  if (/\$|\\[a-z]+/.test(e.statement || '')) out.push('LaTeX in statement');
  if (/ [–—] /.test(`${e.statement} ${e.note || ''}`)) out.push('dash used as punctuation');
  const text = flat(source);
  for (const [k, q] of Object.entries(e.quotes || {})) if (q && !text.includes(flat(q))) out.push(`quote for ${k} is not in the article`);
  if ((e.by || e.year) && !e.quotes?.by) out.push('by or year without a quote');
  if (e.year && !text.includes(String(Math.abs(e.year)))) out.push(`year ${e.year} is not in the text shown`);
  if (e.settled && !text.includes(String(e.settled))) out.push(`year ${e.settled} is not in the text shown`);
  return out;
}

module.exports = { FIELDS, SYSTEMS, problems };

if (require.main === module) (async () => {
  const [mode, model, folder = `drafts-${model}`] = process.argv.slice(2);
  if (!model) throw new Error('usage: write.cjs <pilot|all> <model> [out folder]');
  const out = path.join(dir, folder);
  fs.mkdirSync(out, { recursive: true });
  const all = JSON.parse(fs.readFileSync(path.join(dir, 'candidates.json'), 'utf8')).filter((c) => !c.existing);
  const want = mode === 'pilot' ? new Set(JSON.parse(fs.readFileSync(path.join(dir, 'pilot.json'), 'utf8'))) : null;
  // Left out: articles not downloaded, titles that only forward to another article, and drafts already written.
  const todo = all.filter((c) => (!want || want.has(c.qid)) && fs.existsSync(path.join(dir, 'pages', `${c.qid}.json`)) && !fs.existsSync(path.join(out, `${c.qid}.json`)) && !pieces(c.qid).redirect);
  const batches = [];
  for (let i = 0; i < todo.length; i += 15) batches.push(todo.slice(i, i + 15));
  console.log(`${todo.length} articles in ${batches.length} calls to ${model}`);

  await pool(batches, 3, async (batch, i) => {
    const shown = batch.map((c) => pieces(c.qid));
    const user = JSON.stringify(shown.map(({ qid, title, intro, formal, history }) => ({ qid, title, intro, ...(formal ? { formal } : {}), ...(history ? { history } : {}) })));
    const answer = await ask({ step: 'write', model, system: SYSTEM, user, items: batch.length });
    for (const p of shown) {
      const e = answer.find((a) => a.qid === p.qid);
      if (!e) {
        console.log('  no answer for', p.title);
        continue;
      }
      // Quotes may come from anywhere in what the model saw; years are looked for there too.
      e.verdict ??= e.statement ? 'statement' : 'unclear';
      e.problems = problems(e, `${p.intro}\n${p.formal}\n${p.history}`);
      e.title = p.title;
      fs.writeFileSync(path.join(out, `${p.qid}.json`), JSON.stringify(e, null, 1));
    }
    console.log(`call ${i + 1} of ${batches.length} done`);
  });
})();
