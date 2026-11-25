// Between review and merge: finds a field for the reviewed entries that have none.
//
// The reviewer could only choose among the fields ("systems") the map had
// then. Once fields have been added (.import/new-systems.json, written and
// checked the careful way), this asks a cheap model again for the entries
// still without one, showing it the name, the statement and the field the
// article names. Answers go to .import/placed.json: { qid: [system ids] }.
//
// Usage: node tools/import/place.cjs <model>
const fs = require('fs');
const path = require('path');
const { ask, pool, dir } = require('./model.cjs');

const root = path.join(__dirname, '..', '..');
const extra = fs.existsSync(path.join(dir, 'new-systems.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'new-systems.json'), 'utf8')) : [];
const systems = [...JSON.parse(fs.readFileSync(path.join(root, 'data', 'foundations.json'), 'utf8')).nodes.filter((n) => n.kind === 'system'), ...extra];

const SYSTEM = `You place mathematical statements in fields. The input is a JSON list of { qid, name, statement, field }, where "field" is the branch of mathematics a Wikipedia article names for the statement (it may be missing). For each one, choose from the list below the one or at most two fields the statement belongs to, the most specific first. Go by the field the article names; use the statement only where no field is given or to choose between two candidates. Answer with an empty list when none of them fits: a statement of physics, economics or another science that is not also a statement of one of these fields has no place, and a wrong place is worse than none.

Answer with a JSON list and nothing else, one object per item in the same order: {"qid": "...", "within": ["id", ...]}.

Fields:
${systems.map((s) => `- ${s.id}: ${s.name}. ${s.statement}`).join('\n')}`;

(async () => {
  const model = process.argv[2];
  if (!model) throw new Error('usage: place.cjs <model>');
  const file = path.join(dir, 'placed.json');
  const placed = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const todo = [];
  for (const f of fs.readdirSync(path.join(dir, 'reviewed'))) {
    const e = JSON.parse(fs.readFileSync(path.join(dir, 'reviewed', f), 'utf8'));
    const qid = f.replace('.json', '');
    if (e.verdict === 'statement' && e.kind !== 'axiom' && !e.within?.length && !(qid in placed)) todo.push({ qid, name: e.name, statement: e.statement, ...(e.field ? { field: e.field } : {}) });
  }
  const batches = [];
  for (let i = 0; i < todo.length; i += 40) batches.push(todo.slice(i, i + 40));
  console.log(`${todo.length} entries without a field in ${batches.length} calls to ${model}`);
  await pool(batches, 3, async (batch, n) => {
    const answer = await ask({ step: 'place', model, system: SYSTEM, user: JSON.stringify(batch), items: batch.length });
    for (const item of batch) placed[item.qid] = (answer.find((a) => a.qid === item.qid)?.within || []).filter((id) => systems.some((s) => s.id === id));
    fs.writeFileSync(file, JSON.stringify(placed, null, 1));
    console.log(`call ${n + 1} of ${batches.length} done`);
  });
  console.log(`${Object.values(placed).filter((w) => w.length).length} of ${Object.keys(placed).length} placed`);
})();
