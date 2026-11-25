// One question to a model, with no tools and no browsing: text in, JSON out.
// Used by write.cjs, links.cjs and check.cjs.
//
// The call goes through ~/.local/bin/agent-run (the one place where the agent
// CLI is named). Every call is logged with its token counts to
// .import/usage.jsonl, so the cost of a run can be added up afterwards:
//   node tools/import/model.cjs usage
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = path.join(__dirname, '..', '..', '.import');
const log = path.join(dir, 'usage.jsonl');

function run(args) {
  return new Promise((resolve, reject) => {
    // Started in the temp folder so that no project instructions are loaded into the call.
    execFile(path.join(os.homedir(), '.local/bin/agent-run'), args, { cwd: os.tmpdir(), maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000 }, (err, stdout, stderr) => (err ? reject(new Error(`${err.message}\n${stderr}`.slice(0, 2000))) : resolve(stdout)));
  });
}

// Returns the parsed JSON array the model answered with. Tries twice.
async function ask({ step, model, system, user, items }) {
  for (let attempt = 0; ; attempt++) {
    try {
      const out = JSON.parse(await run(['-p', user, '--model', model, '--system-prompt', system, '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands', '--output-format', 'json']));
      const u = out.usage || {};
      fs.appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), step, model, items, input: u.input_tokens, cacheWrite: u.cache_creation_input_tokens, cacheRead: u.cache_read_input_tokens, output: u.output_tokens, usd: out.total_cost_usd, ms: out.duration_ms }) + '\n');
      const text = String(out.result);
      const answer = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
      if (!Array.isArray(answer)) throw new Error('not a list');
      return answer;
    } catch (e) {
      if (attempt === 1) throw e;
      console.log(`  ${step}: retrying after "${String(e.message).slice(0, 120)}"`);
    }
  }
}

// Runs `job` over `list` with a few calls at a time (IMPORT_POOL=8 in the environment for more).
async function pool(list, size, job) {
  size = +process.env.IMPORT_POOL || size;
  const queue = [...list.entries()];
  await Promise.all(Array.from({ length: size }, async () => {
    for (let next; (next = queue.shift()); ) {
      // A call that fails twice is left out; the scripts skip what is already done, so running them again picks it up.
      await job(next[1], next[0]).catch((e) => console.log(`  call ${next[0] + 1} failed: ${String(e.message).slice(0, 200)}`));
    }
  }));
}

function usage() {
  const sum = {};
  for (const line of fs.readFileSync(log, 'utf8').trim().split('\n')) {
    const r = JSON.parse(line);
    const s = (sum[`${r.step} ${r.model}`] ??= { calls: 0, items: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, usd: 0 });
    s.calls++;
    for (const k of ['items', 'input', 'cacheWrite', 'cacheRead', 'output', 'usd']) s[k] += r[k] || 0;
  }
  for (const s of Object.values(sum)) {
    s.usd = Math.round(s.usd * 100) / 100;
    s.tokensPerItem = Math.round((s.input + s.cacheWrite + s.cacheRead + s.output) / (s.items || 1));
  }
  return sum;
}

module.exports = { ask, pool, usage, dir };

if (require.main === module && process.argv[2] === 'usage') console.table(usage());
