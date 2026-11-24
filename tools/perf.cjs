// Measures how fast the page is: loads it, then zooms, pans, hovers, selects, traces, drops an
// axiom and switches arrangement in headless Chromium, the same way on every run.
//
// Usage: node tools/perf.cjs <desktop|phone|big> [--profile] [--only=zoom-tree,trace-250]
//   desktop: 1440x900.  phone: 375x667 with the processor slowed down four times.
//   big: 1920x1080 at double density (a 4K screen), drawn by the graphics chip as in a real
//   browser window (macOS, needs Playwright's full Chromium). Only this one shows what drawing
//   costs on a large screen; frames come at up to 120 a second there, so read p95Ms and over33.
// Needs a server (python3 -m http.server 8377) or SHOT_URL, and PLAYWRIGHT_CORE as for shots.cjs.
// Prints JSON. Per scenario: taskMs is the time the page's main thread was busy, split into
// script, style, layout and the rest (painting); then the frames (median, 95th percentile and
// worst, how many took over 33 ms). --profile adds the functions that took the most time.
// Run it before and after a change to the drawing code and compare. The slow-connection load
// (load-slow4g) only means something against the live site: the Python server does not compress.
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const url = process.env.SHOT_URL || 'http://127.0.0.1:8377/';
const [device] = process.argv.slice(2);
const withProfile = process.argv.includes('--profile');
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const cfg = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, throttle: 1 },
  phone: { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, throttle: 4 },
  big: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, throttle: 1, launch: { channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'] } },
}[device];

const frameRecorder = () => {
  window.__f = { on: false, t: [] };
  const loop = (t) => {
    if (window.__f.on) window.__f.t.push(t);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  // When the graph is first on screen: the zoom note is written at the end of the first layout.
  window.__ready = null;
  const seen = new MutationObserver(() => {
    const note = document.getElementById('zoom-note');
    if (note && note.textContent && !window.__ready) {
      const at = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => (window.__ready = { script: at, painted: performance.now() })));
      seen.disconnect();
    }
  });
  seen.observe(document, { childList: true, subtree: true, characterData: true });
};

async function open(browser, { network } = {}) {
  const { throttle, launch, ...ctxOpts } = cfg;
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  if (network) {
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  }
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !m.location().url.endsWith('/favicon.ico') && errors.push(m.text())); // the page has no icon
  await page.addInitScript(frameRecorder);
  return { ctx, page, cdp, errors };
}

const metrics = async (cdp) => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const round = (x) => Math.round(x * 10) / 10;

function frameStats(t) {
  const d = t.slice(1).map((x, i) => x - t[i]);
  if (!d.length) return {};
  const sorted = [...d].sort((a, b) => a - b);
  return {
    frames: d.length,
    medianMs: round(sorted[Math.floor(d.length / 2)]),
    p95Ms: round(sorted[Math.floor(d.length * 0.95)]),
    worstMs: round(sorted.at(-1)),
    over33: d.filter((x) => x > 33.4).length,
    over50: d.filter((x) => x > 50).length,
    lostMs: round(d.reduce((s, x) => s + Math.max(0, x - 17), 0)),
  };
}

function topFunctions(profile, n = 12) {
  const dt = profile.timeDeltas;
  const self = new Map();
  const byId = new Map(profile.nodes.map((nd) => [nd.id, nd]));
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) || 0) + (dt[i] || 0)));
  const agg = new Map();
  for (const [id, us] of self) {
    const f = byId.get(id).callFrame;
    const file = f.url.split('/').pop();
    const key = `${f.functionName || '(anonymous)'} ${file}:${f.lineNumber + 1}`;
    agg.set(key, (agg.get(key) || 0) + us / 1000);
  }
  return [...agg]
    .filter(([k]) => !/^\((idle|program|root)\)/.test(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, ms]) => `${round(ms)}ms ${k}`);
}

async function measure(s, name, run, settle = 300) {
  const { page, cdp } = s;
  if (only.length && !only.includes(name)) return void (await run()); // not measured, but the later scenarios build on it
  const m0 = await metrics(cdp);
  if (withProfile) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
  }
  await page.evaluate(() => {
    window.__f.t = [];
    window.__f.on = true;
  });
  const extra = await run();
  await page.waitForTimeout(settle);
  const frames = await page.evaluate(() => {
    window.__f.on = false;
    return window.__f.t;
  });
  const prof = withProfile ? (await cdp.send('Profiler.stop')).profile : null;
  const m1 = await metrics(cdp);
  const d = (k) => (m1[k] - m0[k]) * 1000;
  const out = {
    scriptMs: round(d('ScriptDuration')),
    styleMs: round(d('RecalcStyleDuration')),
    layoutMs: round(d('LayoutDuration')),
    restMs: round(d('TaskDuration') - d('ScriptDuration') - d('RecalcStyleDuration') - d('LayoutDuration')),
    taskMs: round(d('TaskDuration')),
    ...frameStats(frames),
    ...(extra || {}),
  };
  if (prof) out.top = topFunctions(prof);
  results[name] = out;
}

const results = {};

// One synthetic input event per frame, so every run feeds the page the same input.
const perFrame = (page, count, body) =>
  page.evaluate(
    ([count, body]) =>
      new Promise((done) => {
        const fn = new Function('i', 'n', body);
        let i = 0;
        const step = () => {
          if (i >= count) return done();
          fn(i++, count);
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    [count, body],
  );

const find = async (page, text) => {
  await page.fill('#search', text);
  await page.waitForTimeout(200);
  await page.press('#search', 'Enter');
};

(async () => {
  const browser = await chromium.launch(cfg.launch);

  // ---- load, cold cache, three times each ----
  for (const [name, network] of [['load', false], ['load-slow4g', true]]) {
    if (only.length && !only.includes(name)) continue;
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const s = await open(browser, { network });
      if (withProfile && i === 0) {
        await s.cdp.send('Profiler.enable');
        await s.cdp.send('Profiler.setSamplingInterval', { interval: 200 });
        await s.cdp.send('Profiler.start');
      }
      await s.page.goto(url);
      await s.page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
      const prof = withProfile && i === 0 ? (await s.cdp.send('Profiler.stop')).profile : null;
      const m = await metrics(s.cdp);
      const r = await s.page.evaluate(() => ({
        ready: window.__ready,
        fcp: performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint')?.startTime,
        res: performance.getEntriesByType('resource').map((e) => ({ name: e.name.split('/').pop(), start: Math.round(e.startTime), end: Math.round(e.responseEnd), kb: Math.round(e.transferSize / 102.4) / 10 })),
      }));
      runs.push({ graphVisibleMs: round(r.ready.painted), fcpMs: round(r.fcp), scriptMs: round(m.ScriptDuration * 1000), styleMs: round(m.RecalcStyleDuration * 1000), layoutMs: round(m.LayoutDuration * 1000), taskMs: round(m.TaskDuration * 1000), res: r.res, top: prof ? topFunctions(prof, 16) : undefined, errors: s.errors });
      await s.ctx.close();
    }
    runs.sort((a, b) => a.graphVisibleMs - b.graphVisibleMs);
    const mid = runs[1];
    results[name] = { graphVisibleMs: mid.graphVisibleMs, all: runs.map((r) => r.graphVisibleMs), fcpMs: mid.fcpMs, scriptMs: mid.scriptMs, styleMs: mid.styleMs, layoutMs: mid.layoutMs, taskMs: mid.taskMs, transferKb: round(mid.res.reduce((s, r) => s + r.kb, 0)), waterfall: mid.res.map((r) => `${r.start}-${r.end} ${r.name} ${r.kb}kB`), top: runs.find((r) => r.top)?.top, errors: mid.errors };
  }

  // ---- interaction ----
  const s = await open(browser);
  const { page } = s;
  await page.goto(url);
  await page.waitForFunction(() => window.__ready);
  const cx = cfg.viewport.width / 2;
  const cy = cfg.viewport.height / 2;

  // The opening wave: the page switches to "Today" by itself 1.1 s after loading.
  await measure(s, 'opening-wave', () => page.waitForTimeout(4200), 0);

  const wheel = `document.getElementById('graph').dispatchEvent(new WheelEvent('wheel', { deltaY: i < n / 2 ? -30 : 30, clientX: ${cx}, clientY: ${cy}, bubbles: true, cancelable: true, view: window }));`;
  await measure(s, 'zoom-tree', () => perFrame(page, 90, wheel));

  const drag = `
    const g = document.getElementById('graph');
    const a = (i / n) * Math.PI * 2;
    const o = { clientX: ${cx} + Math.sin(a) * 120, clientY: ${cy} + (1 - Math.cos(a)) * 80, bubbles: true, cancelable: true, view: window, button: 0 };
    if (i === 0) g.dispatchEvent(new MouseEvent('mousedown', o));
    else if (i === n - 1) window.dispatchEvent(new MouseEvent('mouseup', o));
    else window.dispatchEvent(new MouseEvent('mousemove', o));`;
  await measure(s, 'pan-tree', () => perFrame(page, 90, drag));

  const hover = `document.getElementById('graph').dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: 40 + (i / n) * ${cfg.viewport.width - 80}, clientY: ${cy} + Math.sin(i / 9) * ${cfg.viewport.height * 0.3}, bubbles: true }));`;
  await measure(s, 'hover-tree', () => perFrame(page, 120, hover));

  // Select ten entries one after the other (search, Enter, the map centres on each).
  await measure(s, 'select-x10', async () => {
    for (const q of ['Riemann Hypothesis', 'Axiom of choice', 'Complex analysis', "Fermat's Last Theorem", 'RSA assumption', 'Density hypothesis', 'Generalized Riemann', 'Axiom of infinity', 'Lindel', 'Extended Riemann']) {
      await find(page, q);
      await page.waitForTimeout(550);
    }
  });

  // The biggest trace on the map: everything built on an axiom of set theory (250 of 263 entries).
  await find(page, 'Axiom of extensionality');
  await page.waitForTimeout(700);
  await measure(s, 'trace-250', async () => {
    await page.locator('.trace-btn', { hasText: 'built on this' }).click();
    await page.waitForTimeout(4200);
  });

  await find(page, 'Riemann Hypothesis');
  await page.waitForTimeout(700);
  await measure(s, 'trace-rh-19', async () => {
    await page.locator('.trace-btn').first().click();
    await page.waitForTimeout(3600);
  });

  // Withdraw an axiom and put it back: a loss wave, then a gain wave.
  await find(page, 'Axiom of choice');
  await page.waitForTimeout(700);
  await measure(s, 'drop-axiom', async () => {
    await page.locator('.whatif-btn').click();
    await page.waitForTimeout(3600);
  });
  await measure(s, 'restore-axiom', async () => {
    await page.locator('.whatif-btn').click();
    await page.waitForTimeout(3600);
  });

  await measure(s, 'rankings', async () => {
    await page.locator('#btn-rankings').click();
    await page.waitForTimeout(400);
  });
  await page.locator('#panel .close').click();
  await page.locator('#btn-all').click();
  await page.waitForTimeout(700);

  // First switch works the Areas arrangement out (a force simulation), later ones only glide.
  await measure(s, 'switch-to-areas-first', async () => {
    const blocked = await page.evaluate(
      () =>
        new Promise((done) => {
          const t0 = performance.now();
          document.getElementById('btn-areas').click();
          const t1 = performance.now();
          requestAnimationFrame(() => done({ clickBlockedMs: Math.round(t1 - t0), toNextFrameMs: Math.round(performance.now() - t0) }));
        }),
    );
    await page.waitForTimeout(1300);
    return blocked;
  });
  await measure(s, 'zoom-areas', () => perFrame(page, 90, wheel));
  await measure(s, 'pan-areas', () => perFrame(page, 90, drag));
  await page.locator('#btn-all').click();
  await page.waitForTimeout(700);
  await measure(s, 'switch-to-tree', async () => {
    await page.locator('#btn-tree').click();
    await page.waitForTimeout(1300);
  });
  await measure(s, 'switch-to-areas-again', async () => {
    await page.locator('#btn-areas').click();
    await page.waitForTimeout(1300);
  });

  results.errors = s.errors;
  results.dom = await page.evaluate(() => document.querySelectorAll('*').length);
  console.log(JSON.stringify(results, null, 1));
  await browser.close();
})();
