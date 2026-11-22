import { validate, computeProven, isRoot, missingFor, rippleOrder } from './propagate.js';

const d3 = window.d3;
const HUBS = ['rh', 'grh', 'erh'];
const SVG_NS = 'http://www.w3.org/2000/svg';
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (id) => document.getElementById(id);

const state = {
  data: null,
  nodes: [],
  byId: new Map(),
  links: [],
  dependents: new Map(),
  mode: 'before',
  whatIf: new Set(),
  real: new Set(), // proven in the selected point in time, without what-ifs
  shown: new Set(), // drawn as proven right now (lags behind during a ripple)
  lit: new Set(), // keys of edges drawn as active
  selected: null,
  focus: false, // dim everything but the selected node's surroundings
  hover: null,
  t: d3.zoomIdentity,
  ripple: null,
  shape: null, // which hub arrangement is laid out: tall, wide or flat
  touched: false,
};

const svg = d3.select('#graph');
const viewport = svg.append('g').attr('class', 'viewport');
const gWaves = viewport.append('g');
const gEdges = viewport.append('g');
const gFlows = viewport.append('g');
const gNodes = viewport.append('g');
const gLabels = svg.append('g');
const zoom = d3.zoom().scaleExtent([0.2, 5]).on('zoom', onZoom);

const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  e.append(...kids.filter(Boolean));
  return e;
};

const name = (id) => state.byId.get(id).short;
const listNames = (ids) => ids.map(name).join(' and ');
const statusOf = (n) => (state.shown.has(n.id) ? 'proven' : n.base === 'conditional' ? 'conditional' : 'open');
const isHypothetical = (id) => state.shown.has(id) && !state.real.has(id);

init();

async function init() {
  const data = await (await fetch('data/theorems.json')).json();
  validate(data.nodes);
  state.data = data;
  state.nodes = data.nodes.map((n) => ({
    ...n,
    needs: n.needs || [],
    related: n.related || [],
    formerly: n.formerly || [],
    r: n.id === 'rh' ? 22 : HUBS.includes(n.id) ? 17 : n.kind === 'hypothesis' ? 11 : 9,
  }));
  state.byId = new Map(state.nodes.map((n) => [n.id, n]));
  for (const n of state.nodes) state.dependents.set(n.id, []);
  for (const n of state.nodes) {
    for (const [type, refs] of [['needs', n.needs], ['related', n.related], ['formerly', n.formerly]]) {
      for (const ref of refs) {
        state.links.push({ source: ref, target: n.id, type, key: `${ref}>${n.id}`, equivalent: type === 'needs' && !!n.equivalent });
      }
    }
    for (const need of n.needs) state.dependents.get(need).push(n.id);
  }

  buildGraph();
  svg.call(zoom).on('dblclick.zoom', null);
  state.real = computeProven(state.nodes, new Set());
  state.shown = new Set(state.real);
  relayout();
  applyStatus();
  renderStatusLine();
  wire();

  setTimeout(() => {
    if (!state.touched) setMode('today');
  }, 1100);
}

/* ---------- drawing ---------- */

function buildGraph() {
  for (const l of state.links) {
    const g = gEdges.append('g').attr('class', `edge ${l.type}`);
    l.line = g.append('line');
    l.chev = g.append('path').attr('class', 'chev').attr('d', l.equivalent ? 'M-8,0 L-2,-4 L-2,4 Z M8,0 L2,-4 L2,4 Z' : 'M4.5,0 L-3,-4 L-3,4 Z');
    l.el = g.node();
  }

  for (const n of state.nodes) {
    const g = gNodes
      .append('g')
      .attr('class', `node kind-${n.kind}${HUBS.includes(n.id) ? ' hub' : ''}`)
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', n.name);
    const inner = g.append('g').attr('class', 'inner');
    inner.append('circle').attr('class', 'halo').attr('r', n.r + 7);
    inner.append('circle').attr('class', 'burst').attr('r', n.r + 2);
    const pop = inner.append('g').attr('class', 'pop');
    if (n.kind === 'theorem') {
      pop.append('circle').attr('class', 'shape').attr('r', n.r);
    } else {
      const s = n.r * (n.kind === 'hypothesis' ? 0.82 : 0.9);
      pop
        .append('rect')
        .attr('class', 'shape')
        .attr('x', -s)
        .attr('y', -s)
        .attr('width', 2 * s)
        .attr('height', 2 * s)
        .attr('rx', 2.5)
        .attr('transform', n.kind === 'hypothesis' ? 'rotate(45)' : null);
    }
    pop.append('path').attr('class', 'check').attr('d', `M${-0.4 * n.r},${0.03 * n.r} L${-0.1 * n.r},${0.32 * n.r} L${0.43 * n.r},${-0.3 * n.r}`);
    if (n.needs.length > 1) n.arc = inner.append('circle').attr('class', 'arc').attr('r', n.r + 4.5).attr('transform', 'rotate(-90)');
    g.on('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select(n.id);
      }
    });
    n.el = g.node();

    const hub = HUBS.includes(n.id);
    n.lines = wrap(n.short, hub ? 22 : 19);
    n.labelW = Math.max(...n.lines.map((s) => s.length)) * (hub ? 7.4 : 6.1);
    const label = gLabels.append('g').attr('class', `label${hub ? ' hub' : ''}`);
    const text = label.append('text');
    n.lines.forEach((line, i) => text.append('tspan').attr('x', 0).attr('dy', i === 0 ? '0.9em' : '1.15em').text(line));
    n.labelEl = label.node();
  }
}

function wrap(text, max) {
  if (text.length <= max) return [text];
  const words = text.split(' ');
  let best = [text];
  let bestLen = text.length;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const len = Math.max(a.length, b.length);
    if (len < bestLen) {
      best = [a, b];
      bestLen = len;
    }
  }
  return best;
}

/* ---------- layout ---------- */

const wide = () => window.innerWidth >= 1000 && window.innerHeight >= 600;

// The part of the window the graph can use: below the header, above the
// bottom strip, and left of the details panel when that sits at the side.
function freeArea(ignorePanel = false) {
  const top = $('status-line').getBoundingClientRect().bottom + 6;
  const strip = wide() ? document.querySelector('.hud-bottom') : $('tally');
  const panel = $('panel');
  const box = panel.getBoundingClientRect();
  const open = !panel.hidden && !ignorePanel;
  const sheet = open && box.width > window.innerWidth * 0.9;
  const stripTop = strip.getBoundingClientRect().top || window.innerHeight;
  const right = open && !sheet ? box.left - 6 : window.innerWidth - 6;
  // On small screens the panel leaves too little room to shrink the graph
  // into, so the view pans to the selected node instead (`pan`).
  return { left: 6, right, top, bottom: sheet ? box.top - 6 : stripTop - 10, pan: sheet || (open && right < 500) };
}

function relayout() {
  $('legend').open = wide();
  const area = freeArea();
  const aspect = (window.innerWidth - 12) / (area.bottom - area.top);
  const shape = aspect < 0.9 ? 'tall' : aspect > 2.2 ? 'flat' : 'wide';
  if (shape !== state.shape) {
    state.shape = shape;
    layout(shape);
    updatePositions();
  }
  fit();
}

// Where the three hubs sit, for tall, ordinary and very flat windows.
const HUB_POS = {
  tall: { rh: [0, -400], grh: [-150, 310], erh: [240, 540] },
  wide: { rh: [-390, 0], grh: [330, -190], erh: [520, 290] },
  flat: { rh: [-560, 0], grh: [300, -40], erh: [900, 60] },
};

function layout(shape) {
  const portrait = shape === 'tall';
  const hubPos = HUB_POS[shape];

  // Each node joins the hub it reaches first through any kind of link.
  const cluster = new Map(HUBS.map((id) => [id, id]));
  const adj = new Map(state.nodes.map((n) => [n.id, []]));
  for (const l of state.links) {
    adj.get(l.source).push(l.target);
    adj.get(l.target).push(l.source);
  }
  const queue = [...HUBS];
  while (queue.length) {
    const id = queue.shift();
    for (const next of adj.get(id)) {
      if (!cluster.has(next)) {
        cluster.set(next, cluster.get(id));
        queue.push(next);
      }
    }
  }

  const sim = state.nodes.map((n, i) => {
    const c = cluster.get(n.id) || 'rh';
    const [hx, hy] = hubPos[c];
    const a = i * 2.399963; // golden angle, so the start is spread and repeatable
    const p = { id: n.id, cluster: c, x: hx + Math.cos(a) * 160, y: hy + Math.sin(a) * 160 };
    if (HUBS.includes(n.id)) [p.fx, p.fy] = [hx, hy];
    return p;
  });
  const simLinks = state.links.map((l) => ({ source: l.source, target: l.target, type: l.type }));
  const hubLink = (l) => HUBS.includes(l.source.id) && !HUBS.includes(l.target.id);

  d3.forceSimulation(sim)
    .force(
      'link',
      d3
        .forceLink(simLinks)
        .id((d) => d.id)
        .distance((l) => (l.type !== 'needs' ? 130 : hubLink(l) ? (l.source.id === 'rh' ? 200 : 165) : 105))
        .strength((l) => (l.type !== 'needs' ? 0.12 : HUBS.includes(l.target.id) ? 0 : 0.55)),
    )
    .force('charge', d3.forceManyBody().strength(-520).distanceMax(520))
    .force('collide', d3.forceCollide((d) => (HUBS.includes(d.id) ? 84 : 56)).strength(0.9).iterations(2))
    .force('x', d3.forceX((d) => hubPos[d.cluster][0]).strength(portrait ? 0.09 : 0.05))
    .force('y', d3.forceY((d) => hubPos[d.cluster][1]).strength(portrait ? 0.05 : 0.09))
    .stop()
    .tick(700);

  for (const p of sim) Object.assign(state.byId.get(p.id), { x: p.x, y: p.y });
}

function updatePositions() {
  for (const n of state.nodes) n.el.setAttribute('transform', `translate(${n.x},${n.y})`);
  for (const l of state.links) {
    const s = state.byId.get(l.source);
    const t = state.byId.get(l.target);
    l.line.attr('x1', s.x).attr('y1', s.y).attr('x2', t.x).attr('y2', t.y);
    const f = l.equivalent ? 0.5 : 0.58;
    const angle = (Math.atan2(t.y - s.y, t.x - s.x) * 180) / Math.PI;
    l.chev.attr('transform', `translate(${s.x + (t.x - s.x) * f},${s.y + (t.y - s.y) * f}) rotate(${angle})`);
  }
}

function fit(animate = false) {
  const area = freeArea(freeArea().pan);
  const xs = state.nodes.map((n) => n.x);
  const ys = state.nodes.map((n) => n.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const padX = Math.min(62, window.innerWidth * 0.08);
  const padTop = 26;
  const padBottom = 44;
  const k = Math.min((area.right - area.left - 2 * padX) / (x1 - x0), (area.bottom - area.top - padTop - padBottom) / (y1 - y0), 1.3);
  const tx = (area.left + area.right) / 2 - (k * (x0 + x1)) / 2;
  const ty = (area.top + padTop + area.bottom - padBottom) / 2 - (k * (y0 + y1)) / 2;
  const target = d3.zoomIdentity.translate(tx, ty).scale(k);
  if (animate && !reduceMotion) svg.transition().duration(350).call(zoom.transform, target);
  else svg.call(zoom.transform, target);
}

function onZoom(e) {
  state.t = e.transform;
  viewport.attr('transform', e.transform);
  svg.node().style.setProperty('--ns', Math.pow(e.transform.k, -0.5));
  positionLabels();
}

const screenR = (n) => n.r * Math.sqrt(state.t.k);

// Labels keep a fixed size on screen. Where two would collide, the less
// important one is hidden until the user zooms in, hovers or selects it.
function positionLabels() {
  const sel = state.selected;
  const near = sel ? neighbours(sel) : new Set();
  const rank = (n) =>
    (n.id === state.hover ? 10000 : 0) +
    (n.id === sel ? 5000 : 0) +
    (HUBS.includes(n.id) ? 1000 : 0) +
    (near.has(n.id) ? 400 : 0) +
    (n.kind === 'hypothesis' ? 100 : 0) +
    state.dependents.get(n.id).length * 10;
  const order = [...state.nodes].sort((a, b) => rank(b) - rank(a));
  const dots = state.nodes.map((n) => {
    const [x, y] = state.t.apply([n.x, n.y]);
    const r = screenR(n);
    return { id: n.id, box: [x - r, y - r, x + r, y + r] };
  });
  const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
  const placed = [];
  for (const n of order) {
    const [x, y] = state.t.apply([n.x, n.y]);
    const hub = HUBS.includes(n.id);
    const h = n.lines.length * (hub ? 15 : 13) + 2;
    const forced = n.id === state.hover || n.id === sel || hub;
    const free = (top) => {
      const box = [x - n.labelW / 2 - 2, top, x + n.labelW / 2 + 2, top + h];
      return placed.some((b) => hit(box, b)) || dots.some((d) => d.id !== n.id && hit(box, d.box)) ? null : box;
    };
    const below = y + screenR(n) + 4;
    const above = y - screenR(n) - 4 - h;
    const top = free(below) || forced ? below : above;
    const box = free(top) || (forced ? [x - n.labelW / 2 - 2, top, x + n.labelW / 2 + 2, top + h] : null);
    n.labelEl.setAttribute('transform', `translate(${x},${top})`);
    n.labelEl.classList.toggle('hidden', !box);
    if (box) placed.push(box);
  }
}

/* ---------- state ---------- */

function neighbours(id) {
  const n = state.byId.get(id);
  const out = new Set([id, ...n.needs, ...n.related, ...n.formerly, ...state.dependents.get(id)]);
  for (const l of state.links) if (l.source === id) out.add(l.target);
  return out;
}

function targetIds() {
  const ids = new Set(state.whatIf);
  if (state.mode === 'today') for (const id of state.data.today.proven) ids.add(id);
  return ids;
}

function litFor(shown) {
  return new Set(state.links.filter((l) => l.type === 'needs' && shown.has(l.source)).map((l) => l.key));
}

function go({ animate }) {
  finishRipple();
  state.real = computeProven(state.nodes, state.mode === 'today' ? new Set(state.data.today.proven) : new Set());
  const after = computeProven(state.nodes, targetIds());
  const kept = new Set([...state.shown].filter((id) => after.has(id)));
  const grows = [...after].some((id) => !kept.has(id));
  state.shown = kept;
  state.lit = litFor(kept);
  if (grows && animate && !reduceMotion) {
    applyStatus();
    startRipple(kept, after);
  } else {
    state.shown = after;
    state.lit = litFor(after);
    applyStatus();
  }
  renderStatusLine();
  renderPanel();
}

function setMode(mode) {
  state.mode = mode;
  state.whatIf.clear();
  $('btn-before').setAttribute('aria-pressed', String(mode === 'before'));
  $('btn-today').setAttribute('aria-pressed', String(mode === 'today'));
  $('btn-reset').hidden = true;
  go({ animate: mode === 'today' });
}

function toggleWhatIf(id) {
  if (state.whatIf.has(id)) state.whatIf.delete(id);
  else state.whatIf.add(id);
  $('btn-reset').hidden = state.whatIf.size === 0;
  state.focus = false; // show the whole graph while the what-if spreads
  go({ animate: true });
}

function applyStatus() {
  const sel = state.selected;
  const near = sel && state.focus ? neighbours(sel) : null;
  for (const n of state.nodes) {
    const st = statusOf(n);
    for (const node of [n.el, n.labelEl]) {
      const cl = node.classList;
      cl.toggle('st-proven', st === 'proven');
      cl.toggle('st-conditional', st === 'conditional');
      cl.toggle('st-open', st === 'open');
      cl.toggle('whatif', isHypothetical(n.id));
      cl.toggle('dim', !!near && !near.has(n.id));
    }
    n.el.classList.toggle('selected', n.id === sel);
    if (n.arc) {
      const met = n.needs.filter((p) => state.shown.has(p)).length;
      const frac = st === 'proven' ? 0 : met / n.needs.length;
      const c = 2 * Math.PI * (n.r + 4.5);
      n.arc.attr('stroke-dasharray', `${frac * c} ${c}`).style('display', frac > 0 ? null : 'none');
    }
  }
  for (const l of state.links) {
    const cl = l.el.classList;
    const on = l.type === 'needs' && state.lit.has(l.key);
    cl.toggle('on', on);
    cl.toggle('waiting', l.type === 'needs' && !on && !state.shown.has(l.target));
    cl.toggle('whatif', on && !state.real.has(l.source));
    cl.toggle('dim', !!near && l.source !== sel && l.target !== sel);
  }
  renderTally();
}

function renderTally() {
  const count = { proven: 0, whatif: 0, conditional: 0, open: 0 };
  for (const n of state.nodes) count[isHypothetical(n.id) ? 'whatif' : statusOf(n)]++;
  const chip = (key, label) => el('span', { class: `t-${key}` }, el('i'), el('b', { text: String(count[key]) }), label);
  $('tally').replaceChildren(
    ...[chip('proven', 'proven'), count.whatif ? chip('whatif', 'what-if') : null, chip('conditional', 'conditional'), chip('open', 'open')].filter(Boolean),
  );
}

function renderStatusLine() {
  const line = $('status-line');
  line.classList.toggle('today', state.mode === 'today' && !state.whatIf.size);
  line.classList.toggle('whatif', state.whatIf.size > 0);
  if (state.whatIf.size) {
    line.replaceChildren(el('strong', { text: 'What-if. ' }), `Treating ${listNames([...state.whatIf])} as proven. This has not happened.`);
  } else if (state.mode === 'today') {
    line.replaceChildren(el('strong', { text: 'The Riemann Hypothesis is proven. ' }), state.data.today.status);
  } else {
    const waiting = state.nodes.filter((n) => n.base === 'conditional').length;
    line.replaceChildren(
      el('strong', { text: 'Before 20 Nov 2026. ' }),
      `The Riemann Hypothesis is open. ${waiting} results on this map are proven only if it, or a related hypothesis, is true.`,
    );
  }
}

/* ---------- ripple ---------- */

function startRipple(before, after) {
  const { flipped, touched } = rippleOrder(state.nodes, before, after);
  const seeds = [...flipped].filter(([, depth]) => depth === 0).map(([id]) => state.byId.get(id));
  const fromSeed = (n) => Math.min(...seeds.map((s) => Math.hypot(n.x - s.x, n.y - s.y)));
  const involved = [...flipped.keys(), ...touched.keys()].map((id) => state.byId.get(id));
  const maxDist = Math.max(140, ...involved.map(fromSeed));
  const speed = maxDist / 2200; // graph units per millisecond
  const hypothetical = seeds.some((s) => !state.real.has(s.id));

  // A node changes when the wave front reaches it, but never before the
  // requirement it follows from has changed.
  const at = new Map();
  for (const [id, depth] of [...flipped, ...touched].sort((a, b) => a[1] - b[1])) {
    const n = state.byId.get(id);
    if (flipped.has(id) && depth === 0) {
      at.set(id, 0);
      continue;
    }
    const parents = n.needs.filter((p) => flipped.has(p)).map((p) => at.get(p));
    at.set(id, Math.max(150 + fromSeed(n) / speed, Math.max(...parents) + 260));
  }

  const flows = state.links
    .filter((l) => l.type === 'needs' && flipped.has(l.source))
    .map((l) => {
      const s = state.byId.get(l.source);
      const t = state.byId.get(l.target);
      const start = at.get(l.source);
      const end = at.has(l.target) ? at.get(l.target) : start + Math.min(900, Math.max(300, Math.hypot(t.x - s.x, t.y - s.y) / speed));
      const g = gFlows.append('g').attr('class', `flow${hypothetical ? ' whatif' : ''}`).style('display', 'none');
      const line = g.append('line').attr('x1', s.x).attr('y1', s.y);
      const dot = g.append('circle').attr('r', 3.5 / state.t.k);
      return { l, s, t, start, end, g, line, dot, done: false };
    });

  const reach = maxDist + 110;
  const waves = seeds.flatMap((s) =>
    [0, 280, 560].map((delay, i) => ({
      delay,
      alpha: 0.75 - i * 0.2,
      el: gWaves.append('circle').attr('class', `wave${hypothetical ? ' whatif' : ''}`).attr('cx', s.x).attr('cy', s.y).attr('stroke-width', 2.5 - i * 0.7).style('display', 'none'),
    })),
  );

  const events = [...at].map(([id, time]) => ({ id, time, flip: flipped.has(id) })).sort((a, b) => a.time - b.time);
  const end = Math.max(...events.map((e) => e.time), ...flows.map((f) => f.end), 560 + reach / speed) + 150;
  const ripple = { after, flows, waves, raf: 0 };
  state.ripple = ripple;
  let next = 0;
  const t0 = performance.now();

  const frame = (now) => {
    const t = now - t0;
    let dirty = false;

    for (const w of waves) {
      const r = (t - w.delay) * speed;
      const visible = r > 0 && r < reach;
      w.el.style('display', visible ? null : 'none');
      if (visible) w.el.attr('r', r).attr('opacity', w.alpha * (1 - r / reach));
    }

    for (const f of flows) {
      if (f.done || t < f.start) continue;
      const p = Math.min(1, (t - f.start) / (f.end - f.start));
      const x = f.s.x + (f.t.x - f.s.x) * p;
      const y = f.s.y + (f.t.y - f.s.y) * p;
      f.g.style('display', null);
      f.line.attr('x2', x).attr('y2', y);
      f.dot.attr('cx', x).attr('cy', y);
      if (p >= 1) {
        f.done = true;
        f.g.remove();
        state.lit.add(f.l.key);
        dirty = true;
      }
    }

    while (next < events.length && events[next].time <= t) {
      const e = events[next++];
      const node = state.byId.get(e.id);
      if (e.flip) state.shown.add(e.id);
      pulse(node.el, e.flip ? 'flip' : 'denied');
      dirty = true;
      if (e.id === state.selected) renderPanel();
    }

    if (dirty) applyStatus();
    if (t < end) ripple.raf = requestAnimationFrame(frame);
    else finishRipple();
  };
  ripple.raf = requestAnimationFrame(frame);
}

function pulse(node, cls) {
  node.classList.remove('flip', 'denied');
  node.getBoundingClientRect(); // restart the CSS animation
  node.classList.add(cls);
  setTimeout(() => node.classList.remove(cls), 1000);
}

function finishRipple() {
  const ripple = state.ripple;
  if (!ripple) return;
  cancelAnimationFrame(ripple.raf);
  ripple.flows.forEach((f) => f.g.remove());
  ripple.waves.forEach((w) => w.el.remove());
  state.ripple = null;
  state.shown = ripple.after;
  state.lit = litFor(ripple.after);
  applyStatus();
  renderPanel();
}

/* ---------- panel ---------- */

function select(id) {
  const wasOpen = !$('panel').hidden;
  state.selected = id;
  state.focus = !!id;
  applyStatus();
  renderPanel();
  positionLabels();
  const area = freeArea();
  if (area.pan) ensureVisible(state.byId.get(id), area);
  else if (wasOpen !== !!id) fit(true);
}

function ensureVisible(n, area) {
  const box = { left: 50, right: area.right - 50, top: area.top + 30, bottom: area.bottom - 50 };
  const [x, y] = state.t.apply([n.x, n.y]);
  const dx = Math.max(box.left, Math.min(box.right, x)) - x;
  const dy = Math.max(box.top, Math.min(box.bottom, y)) - y;
  if (dx || dy) svg.transition().duration(reduceMotion ? 0 : 350).call(zoom.translateBy, dx / state.t.k, dy / state.t.k);
}

function refList(ids) {
  return el(
    'ul',
    { class: 'reflist' },
    ...ids.map((id) => {
      const n = state.byId.get(id);
      const dot = el('span', { class: `dot ${statusOf(n)}${isHypothetical(id) ? ' whatif' : ''}` });
      return el('li', {}, el('button', { type: 'button', onclick: () => select(id) }, dot, el('span', { text: n.name })));
    }),
  );
}

function explain(n) {
  const today = state.data.today;
  const proven = state.shown.has(n.id);
  if (n.base === 'proven') return 'Proven without assuming any hypothesis.';
  if (state.whatIf.has(n.id)) return 'You marked this as proven to see what would follow. It is still open.';
  if (proven && state.mode === 'today' && today.proven.includes(n.id)) return today.status;
  if (proven) {
    const verb = n.needs.length > 1 ? 'are' : 'is';
    return isHypothetical(n.id)
      ? `Would be proven in your what-if, because ${listNames(n.needs)} would be.`
      : `Proven, because ${listNames(n.needs)} ${verb} proven.`;
  }
  const missing = missingFor(state.nodes, state.shown, n.id);
  if (n.base === 'conditional') return `Proven only on condition. Still waiting on: ${listNames(missing)}.`;
  if (today.claimed.includes(n.id)) return `Open. ${today.claimedNote}`;
  return missing.length && !isRoot(state.nodes, n.id) ? `Open. Would follow from ${listNames(missing)}.` : 'Open.';
}

function renderPanel() {
  const panel = $('panel');
  const n = state.selected && state.byId.get(state.selected);
  panel.hidden = !n;
  document.body.classList.toggle('panel-open', !!n);
  if (!n) return;

  const st = statusOf(n);
  const hypo = isHypothetical(n.id);
  const kind = { hypothesis: 'Hypothesis', theorem: 'Result', data: 'Computed data' }[n.kind];
  const stLabel = hypo ? 'Proven in what-if' : { proven: 'Proven', conditional: 'Conditional', open: 'Open' }[st];
  const dependents = state.dependents.get(n.id);
  const root = isRoot(state.nodes, n.id);
  const canWhatIf = state.whatIf.has(n.id) || (root && !state.shown.has(n.id) && !state.ripple);
  const section = (title, ids) => (ids.length ? [el('h3', { text: title }), refList(ids)] : []);
  const links = [{ title: new URL(n.url).hostname.replace(/^(www|en)\./, ''), url: n.url }, ...(n.id === 'rh' || state.data.today.claimed.includes(n.id) ? state.data.today.sources : [])];
  const scroll = panel.dataset.id === n.id ? panel.scrollTop : 0;

  const parts = [
    el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', onclick: () => select(null), text: '✕' }),
    el('div', { class: 'badges' }, el('span', { class: 'badge', text: kind }), el('span', { class: `badge ${hypo ? 'whatif' : st}`, text: stLabel })),
    el('h2', { text: n.name }),
    el('p', { class: 'statement', text: n.statement }),
    el('p', { class: 'by', text: n.by }),
    el('p', { class: 'explain', text: explain(n) }),
    n.equivalent ? el('p', { class: 'explain', text: 'Equivalent to the Riemann Hypothesis: each one implies the other.' }) : null,
    n.note ? el('p', { class: 'note', text: n.note }) : null,
    canWhatIf
      ? el('button', {
          class: 'whatif-btn',
          type: 'button',
          text: state.whatIf.has(n.id) ? 'Undo this what-if' : 'What if this is proven?',
          onclick: () => toggleWhatIf(n.id),
        })
      : null,
    ...section(n.kind === 'hypothesis' ? 'Would follow from' : 'Proven assuming', n.needs),
    ...section('First proven assuming', n.formerly),
    ...section('Related', n.related),
    ...section('What follows from it', dependents),
    el('h3', { text: 'Sources' }),
    el('ul', { class: 'links' }, ...links.map((s) => el('li', {}, el('a', { href: s.url, target: '_blank', rel: 'noopener', text: s.title })))),
  ];
  panel.replaceChildren(...parts.filter(Boolean));
  panel.dataset.id = n.id;
  panel.scrollTop = scroll;
}

/* ---------- input ---------- */

function nodeAt(clientX, clientY) {
  let best = null;
  let bestD = Infinity;
  for (const n of state.nodes) {
    const [x, y] = state.t.apply([n.x, n.y]);
    const d = Math.hypot(x - clientX, y - clientY);
    if (d < Math.max(22, screenR(n) + 8) && d < bestD) [best, bestD] = [n, d];
  }
  return best;
}

function wire() {
  svg.on('click', (e) => {
    state.touched = true;
    const n = nodeAt(e.clientX, e.clientY);
    select(n ? n.id : null);
  });
  svg.on('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const n = nodeAt(e.clientX, e.clientY);
    const id = n ? n.id : null;
    if (id === state.hover) return;
    state.hover = id;
    svg.classed('hovering', !!id);
    positionLabels();
  });
  $('btn-before').addEventListener('click', () => {
    state.touched = true;
    setMode('before');
  });
  $('btn-today').addEventListener('click', () => {
    state.touched = true;
    setMode('today');
  });
  $('btn-replay').addEventListener('click', () => {
    state.touched = true;
    setMode('before');
    setTimeout(() => setMode('today'), 500);
  });
  $('btn-reset').addEventListener('click', () => {
    state.whatIf.clear();
    $('btn-reset').hidden = true;
    go({ animate: false });
  });
  $('status-line').addEventListener('click', () => select('rh'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') select(null);
  });
  let timer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(relayout, 150);
  });
}
