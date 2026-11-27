// Clicks through every feature in headless Chromium and saves a screenshot of each step.
//
// Usage: node tools/shots.cjs <name> <width> <height> [mobile]
//   desktop:          node tools/shots.cjs d 1440 900
//   phone portrait:   node tools/shots.cjs p 375 667 mobile
//   phone landscape:  node tools/shots.cjs l 667 375 mobile
// Needs a server (python3 -m http.server 8377) or SHOT_URL pointing at the live site.
// Env: PLAYWRIGHT_CORE (path to a playwright-core package, if it is not installed here),
//      SHOT_DIR (where the PNGs go, default: the system temp folder),
//      AXIOM, DEEP, AREA, HIGH, FIELD, INBALL (which statements, area and subject the run uses;
//      INBALL is a statement inside the ball of FIELD in the Molecule arrangement).
// Prints a JSON summary; "errors" must be empty. Look at the images, the summary is not enough.
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const path = require('path');
const os = require('os');

const [name, w, h, mobile] = process.argv.slice(2);
const dir = process.env.SHOT_DIR || os.tmpdir();
const out = (step) => path.join(dir, `${name}-${step}.png`);
const URL = process.env.SHOT_URL || 'http://127.0.0.1:8377/';
const AXIOM = process.env.AXIOM || 'Axiom of choice';
const DEEP = process.env.DEEP || 'Prime number theorem in short';
const AREA = process.env.AREA || 'Logic and set theory';
const HIGH = process.env.HIGH || "Fermat's Last Theorem";
const FIELD = process.env.FIELD || 'Measure theory';
const INBALL = process.env.INBALL || "Egorov's theorem";

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2, isMobile: !!mobile, hasTouch: !!mobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('requestfailed', (r) => errors.push('failed: ' + r.url()));
  const info = {};
  const shot = async (step) => page.screenshot({ path: out(step) });
  const find = async (text) => {
    await page.fill('#search', text);
    await page.waitForTimeout(150);
    await page.press('#search', 'Enter');
    await page.waitForTimeout(700);
    return page.evaluate(() => document.querySelector('#panel h2')?.textContent);
  };
  const tally = () => page.evaluate(() => document.getElementById('tally').innerText.replace(/\s+/g, ' '));

  await page.goto(URL);
  await page.waitForSelector('.node:not(.gone)');
  await page.waitForTimeout(350);
  info.nodes = await page.evaluate(() => document.querySelectorAll('.node').length);
  info.before = await tally();
  const shown = () => page.evaluate(() => document.querySelectorAll('.node:not(.gone)').length);
  info.shownOverview = await shown();
  await shot('1-before');
  await page.waitForTimeout(1900);
  await shot('2-mid');
  await page.waitForTimeout(3500);
  info.today = await tally();
  await shot('3-today');

  info.found = await find('Riemann Hypothesis');
  await shot('4-panel');
  await page.locator('.trace-btn').first().click();
  await page.waitForTimeout(1500);
  await shot('5-down-mid');
  await page.waitForTimeout(3000);
  info.downTraced = await page.evaluate(() => document.querySelectorAll('.node.traced').length);
  await shot('6-down');

  info.deep = await find(DEEP);
  await page.locator('.trace-btn', { hasText: 'This rests on' }).click();
  await page.waitForTimeout(4500);
  info.upTraced = await page.evaluate(() => document.querySelectorAll('.node.traced').length);
  await shot('7-up');

  // The tree: from a result high up, follow everything it stands on down to the axioms.
  info.high = await find(HIGH);
  await page.locator('.trace-btn', { hasText: 'Down to the axioms' }).click();
  await page.waitForTimeout(5000);
  info.rootsTraced = await page.evaluate(() => document.querySelectorAll('.node.traced').length);
  await shot('7b-roots');
  info.system = await find('Complex analysis');
  await shot('7c-system');

  info.axiom = await find(AXIOM);
  await shot('8-axiom');
  await page.locator('.whatif-btn').click();
  await page.waitForTimeout(1300);
  await shot('9-drop-mid');
  await page.waitForTimeout(3000);
  info.dropped = await tally();
  info.status = await page.evaluate(() => document.getElementById('status-line').textContent);
  await shot('10-dropped');
  await page.locator('.whatif-btn').click();
  await page.waitForTimeout(4500);
  info.reset = await tally();

  await page.locator('#btn-rankings').click();
  await page.waitForTimeout(500);
  info.rankings = await page.evaluate(() => [...document.querySelectorAll('#panel h3')].map((h) => h.textContent + ': ' + h.nextElementSibling.querySelector('.r-name')?.textContent + ' (' + h.nextElementSibling.querySelector('.r-num')?.textContent + ')'));
  await shot('11-rankings');
  await page.locator('#panel .close').click();
  await page.waitForTimeout(300);
  await page.locator('#btn-all').click();
  await page.waitForTimeout(700);
  await shot('11b-tree');
  // Zooming in brings in the entries that the overview leaves out.
  info.shownTree = await shown();
  await page.mouse.move(+w / 2, +h / 2);
  for (const step of ['11d-zoom1', '11e-zoom2']) {
    await page.mouse.wheel(0, -260);
    await page.waitForTimeout(600);
    info[`shown-${step}`] = await shown();
    await shot(step);
  }
  info.zoomNote = await page.evaluate(() => document.getElementById('zoom-note').textContent);
  await page.locator('#btn-all').click();
  await page.waitForTimeout(700);
  await page.locator('#btn-areas').click();
  await page.waitForTimeout(1400);
  await shot('11c-areas');
  await page.locator(`.area-label[aria-label="Zoom to ${AREA}"]`).click();
  await page.waitForTimeout(800);
  info.hiddenLabelsInArea = await page.evaluate(() => document.querySelectorAll('.label.hidden').length);
  await shot('12-area');

  // The molecule: the subjects as balls joined by bonds, the statements that others rest on around them.
  await page.locator('#btn-molecule').click();
  await page.waitForTimeout(1400);
  await page.locator('#btn-all').click();
  await page.waitForTimeout(700);
  info.shownMolecule = await shown();
  await shot('13-molecule');
  await page.mouse.move(+w / 2, +h / 2);
  for (const step of ['13b-zoom1', '13c-zoom2', '13d-zoom3']) {
    await page.mouse.wheel(0, -420);
    await page.waitForTimeout(600);
    info[`shown-${step}`] = await shown();
    await shot(step);
  }
  info.field = await find(FIELD);
  await shot('14-field');
  // Into the ball of that subject: a click on the ball (beside the subject's own mark) zooms until it fills the
  // window, the wheel goes on until all the statements inside it are drawn.
  const [bx, by] = await page.evaluate(() => {
    const ball = [...document.querySelectorAll('.ball')].find((c) => c.getAttribute('transform') === document.querySelector('.node.selected').getAttribute('transform')).getBoundingClientRect();
    return [ball.x + ball.width * 0.2, ball.y + ball.height * 0.5]; // left of the mark: on a phone held sideways the lower part is behind the bottom strip
  });
  await page.keyboard.press('Escape'); // with the subject selected its statements are drawn, and the click would pick one
  await page.waitForTimeout(500);
  await page.mouse.click(bx, by);
  await page.waitForTimeout(1100);
  info.ballOnScreen = await page.evaluate(() => Math.round(Math.max(...[...document.querySelectorAll('.ball')].map((c) => c.getBoundingClientRect().width))));
  info['shown-14b-into-ball'] = await shown();
  await shot('14b-into-ball');
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -420);
  await page.waitForTimeout(700);
  info['shown-14c-inside-ball'] = await shown();
  await shot('14c-inside-ball');
  // A statement that lies inside a ball: selected, its lines are drawn.
  info.inBall = await find(INBALL);
  await shot('14d-statement-in-ball');
  await find(FIELD);
  await page.locator('.trace-btn', { hasText: 'built on this' }).click();
  await page.waitForTimeout(5000);
  info.fieldTraced = await page.evaluate(() => document.querySelectorAll('.node.traced').length);
  await shot('15-field-trace');
  await page.locator('#btn-tree').click();
  await page.waitForTimeout(1400);
  await shot('16-back-to-tree');
  info.scroll = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
  console.log(JSON.stringify({ name, dir, info, errors }, null, 1));
  await browser.close();
})();
