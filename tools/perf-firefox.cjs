// Measures zooming in the installed Firefox, which draws the graph differently from Chromium
// (tools/perf.cjs) and was slow in places where Chromium was not.
//
// Usage: node tools/perf-firefox.cjs [play]
// Opens a Firefox window of its own for about 15 seconds (temporary profile, yours is not touched),
// zooms in and out for 240 frames and prints the frames:
// how many took longer than 25 ms (one missed screen refresh at 60 Hz) and than 42 ms (two).
// With "play" it starts the playback instead and prints three lines: its first six seconds, six seconds
// from the middle (where most entries appear), and the zooming while it plays on (about 30 seconds in all).
// Needs a server (python3 -m http.server 8377) or SHOT_URL, Node 22 and macOS. The window has to
// stay in front while it runs. Run it twice: single runs differ by a few frames.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const url = process.env.SHOT_URL || 'http://127.0.0.1:8377/';
const view = process.argv.includes('play') ? 'play' : '';
const port = 9333 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'theorem-ripple-firefox-'));
const prefs = { 'browser.shell.checkDefaultBrowser': false, 'browser.aboutwelcome.enabled': false, 'datareporting.policy.dataSubmissionEnabled': false, 'browser.startup.homepage_override.mstone': 'ignore', 'browser.startup.page': 0, 'app.update.enabled': false };
fs.writeFileSync(path.join(profile, 'user.js'), Object.entries(prefs).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n'));
const firefox = spawn('/Applications/Firefox.app/Contents/MacOS/firefox', ['--profile', profile, '--no-remote', '--new-instance', '--remote-debugging-port', String(port), '--width', '1920', '--height', '1080', 'about:blank'], { stdio: 'ignore' });
const finish = (code) => {
  firefox.kill();
  setTimeout(() => {
    fs.rmSync(profile, { recursive: true, force: true });
    process.exit(code);
  }, 800);
};
setTimeout(() => {
  console.log('no result after 90 s');
  finish(1);
}, 90000);

// Runs in the page: one wheel step per frame, as tools/perf.cjs does.
const inPage = async (view) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  while (!document.querySelector('.node:not(.gone)')) await wait(50);
  await wait(5500); // the opening wave
  const round = (x) => Math.round(x * 10) / 10;
  const stats = (t) => {
    const d = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
    return JSON.stringify({ window: `${innerWidth}x${innerHeight} x${devicePixelRatio}`, frames: d.length, totalMs: round(t.at(-1) - t[0]), medianMs: round(d[d.length >> 1]), p95Ms: round(d[Math.floor(d.length * 0.95)]), worstMs: round(d.at(-1)), over25: d.filter((x) => x > 25).length, over42: d.filter((x) => x > 42).length });
  };
  const watch = (ms) =>
    new Promise((done) => {
      const t = [];
      const step = (now) => {
        t.push(now);
        if (now - t[0] >= ms) return done(stats(t));
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  const lines = [];
  if (view === 'play') {
    document.getElementById('btn-play').click();
    await wait(1600);
    lines.push('start ' + (await watch(6000)));
    const slider = document.getElementById('play-slider');
    slider.value = Math.round(slider.max * 0.45);
    slider.dispatchEvent(new Event('input'));
    document.getElementById('play-toggle').click();
    lines.push('middle ' + (await watch(6000)));
  }
  const graph = document.getElementById('graph');
  const t = [];
  await new Promise((done) => {
    let i = 0;
    const step = (now) => {
      t.push(now);
      if (i >= 240) return done();
      const dir = i < 80 ? -1 : i < 160 ? 1 : Math.floor(i / 20) % 2 ? 1 : -1; // in, out, then short strokes
      graph.dispatchEvent(new WheelEvent('wheel', { deltaY: dir * 24, clientX: innerWidth / 2, clientY: innerHeight / 2, bubbles: true, cancelable: true, view: window }));
      i++;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  lines.push((view === 'play' ? 'zoom ' : '') + stats(t));
  return lines.join('\n');
};

(async () => {
  // Firefox is driven over WebDriver BiDi: JSON messages on a WebSocket.
  let ws = null;
  for (let i = 0; i < 60 && !ws; i++) {
    await new Promise((r) => setTimeout(r, 500));
    ws = await new Promise((ok) => {
      const w = new WebSocket(`ws://127.0.0.1:${port}/session`);
      w.onopen = () => ok(w);
      w.onerror = () => ok(null);
    });
  }
  if (!ws) throw new Error('could not connect to Firefox');
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  };
  const send = (method, params = {}) =>
    new Promise((ok, fail) => {
      pending.set(++id, (msg) => (msg.type === 'error' ? fail(new Error(`${method}: ${msg.message}`)) : ok(msg.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send('session.new', { capabilities: {} });
  const context = (await send('browsingContext.getTree')).contexts[0].context;
  await send('browsingContext.navigate', { context, url, wait: 'complete' });
  const res = await send('script.evaluate', { expression: `(${inPage})(${JSON.stringify(view)})`, target: { context }, awaitPromise: true });
  console.log(res.result?.value ?? JSON.stringify(res));
  await send('browser.close').catch(() => {});
  finish(0);
})().catch((e) => {
  console.log('failed:', e.message);
  finish(1);
});
