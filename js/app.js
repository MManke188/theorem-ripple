import { normalize, validate, computeProven, isRoot, missingFor, rippleOrder, reach, layers, foundationsOf } from './propagate.js';

const d3 = window.d3;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (id) => document.getElementById(id);
const andList = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

const state = {
  index: null, // data/index.json: areas, the "today" event, axioms assumed by default
  nodes: [],
  byId: new Map(),
  links: [],
  dependents: new Map(), // id -> the statements that need it
  built: new Map(), // id -> the entries built directly within it (systems and axioms)
  areas: [],
  layout: 'tree', // how the map is arranged: 'tree' (axioms at the bottom) or 'areas' (one cluster per field)
  pos: {}, // positions per arrangement for the current shape, worked out when first shown
  tween: 0,
  mode: 'before',
  whatIf: new Set(), // statements the reader marked as proven or assumed
  dropped: new Set(), // default axioms the reader stopped assuming
  real: new Set(), // what holds at the selected point in time, without what-ifs
  shown: new Set(), // drawn as holding right now (lags behind during a wave)
  lit: new Set(), // keys of links drawn as active
  selected: null,
  focus: false, // dim everything but the selected node's surroundings
  view: 'node', // what the panel shows: a node or the rankings
  trace: null, // { origin, dir, seen, edges } while "what rests on this" is shown
  hover: null,
  t: d3.zoomIdentity,
  wave: null,
  shape: null, // the proportions of the free part of the window: tall, wide or flat (areas), and how often the tree's rows are folded
  touched: false,
};

const svg = d3.select('#graph');
const viewport = svg.append('g').attr('class', 'viewport');
const gWaves = viewport.append('g');
const gEdges = viewport.append('g');
const gFlows = viewport.append('g');
const gNodes = viewport.append('g');
const gAreas = svg.append('g');
const gLabels = svg.append('g');
const zoom = d3.zoom().scaleExtent([0.12, 5]).on('zoom', onZoom);

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

const node = (id) => state.byId.get(id);
const listNames = (ids) => andList.format(ids.map((id) => node(id).short));
// A system (a number system or a theory) is not a statement and has no status.
const statusOf = (n) => (n.kind === 'system' ? 'system' : state.shown.has(n.id) ? 'proven' : n.base === 'conditional' ? 'conditional' : 'open');
const isStatement = (n) => n.kind !== 'system' && n.kind !== 'axiom';
const isHypothetical = (id) => state.shown.has(id) && !state.real.has(id);
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

init();

async function init() {
  const index = await (await fetch('data/index.json')).json();
  const files = await Promise.all(index.areas.map(async (a) => (await (await fetch(`data/${a.file}`)).json()).nodes));
  const nodes = normalize(files.flat());
  validate(nodes);
  state.index = index;
  state.nodes = nodes;
  state.byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    state.dependents.set(n.id, []);
    state.built.set(n.id, []);
  }
  for (const n of nodes) {
    n.inputs = [...n.needs, ...n.anyOf]; // everything it is linked to upstream
    for (const [type, refs] of [['needs', n.inputs], ['within', n.within], ['related', n.related], ['formerly', n.formerly]]) {
      for (const ref of refs) {
        const inner = type === 'within' && state.byId.get(ref).area === n.area; // both ends in the same area
        state.links.push({ source: ref, target: n.id, type, inner, key: `${type === 'within' ? 'in:' : ''}${ref}>${n.id}`, equivalent: type === 'needs' && !!n.equivalent });
      }
    }
    for (const need of n.inputs) state.dependents.get(need).push(n.id);
    for (const sys of n.within) state.built.get(sys).push(n.id);
  }
  const layer = layers(nodes);
  for (const n of nodes) {
    n.down = reach(nodes, n.id, 'down'); // what rests on it
    n.up = reach(nodes, n.id, 'up'); // what it rests on
    n.roots = reach(nodes, n.id, 'up', foundationsOf); // the same, plus the systems it is built in, down to the axioms
    n.above = reach(nodes, n.id, 'down', foundationsOf); // everything that stands on it in any way
    n.weight = n.down.size;
    n.depth = Math.max(0, ...n.up.values());
    n.layer = layer.get(n.id); // height above the axioms
    n.r = n.kind === 'system' ? Math.min(22, 9 + 0.9 * Math.sqrt(n.above.size)) : Math.min(24, 8 + 2.3 * Math.sqrt(n.weight)) + (n.kind === 'theorem' ? 0 : 1.5);
  }
  // The most rested-on statements keep their label at every zoom level, and so do the systems.
  [...nodes].sort((a, b) => b.weight - a.weight).slice(0, 12).forEach((n) => (n.hub = n.weight >= 4));
  for (const n of nodes) n.big = !!n.hub || n.kind === 'system';
  state.areas = index.areas.map((a) => ({ ...a, nodes: nodes.filter((n) => n.area === a.id) })).filter((a) => a.nodes.length);

  buildGraph();
  document.body.classList.add(`view-${state.layout}`);
  svg.call(zoom).on('dblclick.zoom', null);
  state.real = computeProven(nodes, baseMarks());
  state.shown = new Set(state.real);
  state.lit = litFor(state.shown);
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
    const g = gEdges.append('g').attr('class', `edge ${l.type}${l.inner ? ' inner' : ''}`);
    l.line = g.append('line');
    l.chev = g.append('path').attr('class', 'chev').attr('d', l.equivalent ? 'M-8,0 L-2,-4 L-2,4 Z M8,0 L2,-4 L2,4 Z' : 'M4.5,0 L-3,-4 L-3,4 Z');
    l.el = g.node();
  }

  for (const n of state.nodes) {
    const g = gNodes
      .append('g')
      .attr('class', `node kind-${n.kind}${n.hub ? ' hub' : ''}`)
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', n.name);
    const inner = g.append('g').attr('class', 'inner');
    inner.append('circle').attr('class', 'halo').attr('r', n.r + 7);
    inner.append('circle').attr('class', 'burst').attr('r', n.r + 2);
    const pop = inner.append('g').attr('class', 'pop');
    if (n.kind === 'theorem') {
      pop.append('circle').attr('class', 'shape').attr('r', n.r);
    } else if (n.kind === 'axiom') {
      const points = d3.range(6).map((i) => [Math.cos((i * Math.PI) / 3) * n.r * 1.08, Math.sin((i * Math.PI) / 3) * n.r * 1.08].join(','));
      pop.append('polygon').attr('class', 'shape').attr('points', points.join(' '));
      pop.append('circle').attr('class', 'pip').attr('r', n.r * 0.32);
    } else {
      const s = n.r * { hypothesis: 0.82, data: 0.9, system: 0.88 }[n.kind];
      pop
        .append('rect')
        .attr('class', 'shape')
        .attr('x', -s)
        .attr('y', -s)
        .attr('width', 2 * s)
        .attr('height', 2 * s)
        .attr('rx', n.kind === 'system' ? s * 0.42 : 2.5)
        .attr('transform', n.kind === 'hypothesis' ? 'rotate(45)' : null);
    }
    pop.append('path').attr('class', 'check').attr('d', `M${-0.4 * n.r},${0.03 * n.r} L${-0.1 * n.r},${0.32 * n.r} L${0.43 * n.r},${-0.3 * n.r}`);
    if (n.needs.length > 1) n.arc = inner.append('circle').attr('class', 'arc').attr('r', n.r + 4.5).attr('transform', 'rotate(-90)');
    if (n.claim || state.index.today.claimed.includes(n.id)) inner.append('circle').attr('class', 'flag').attr('r', 3.6).attr('cx', n.r * 0.95).attr('cy', -n.r * 0.95);
    g.on('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select(n.id);
      }
    });
    n.el = g.node();

    n.lines = wrap(n.short, n.big ? 22 : 19);
    n.labelW = Math.max(...n.lines.map((s) => s.length)) * (n.big ? 7.4 : 6.1);
    const label = gLabels.append('g').attr('class', `label${n.big ? ' hub' : ''}${n.kind === 'system' ? ' sys' : ''}`);
    const text = label.append('text');
    n.lines.forEach((line, i) => text.append('tspan').attr('x', 0).attr('dy', i === 0 ? '0.9em' : '1.15em').text(line));
    n.labelEl = label.node();
  }

  for (const a of state.areas) {
    const g = gAreas.append('g').attr('class', 'area-label').attr('role', 'button').attr('tabindex', 0).attr('aria-label', `Zoom to ${a.name}`);
    g.append('text').text(a.name);
    const go = (e) => {
      e.stopPropagation();
      state.touched = true;
      fit(true, a.nodes);
    };
    g.on('click', go).on('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && go(e));
    a.labelEl = g.node();
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
  return { left: 6, right, top, bottom: sheet ? box.top - 6 : stripTop - 10 };
}

function relayout() {
  $('legend').open = wide();
  const area = freeArea(true);
  const aspect = (window.innerWidth - 12) / (area.bottom - area.top);
  // The tree is much wider than high. Where the free part of the window is not, its crowded rows are folded into two or three lines.
  const shape = `${aspect < 0.9 ? 'tall' : aspect > 2.2 ? 'flat' : 'wide'}/${aspect < 0.7 ? 3 : aspect < 1.4 ? 2 : 1}`;
  if (shape !== state.shape || state.tween) {
    cancelAnimationFrame(state.tween);
    state.tween = 0;
    if (shape !== state.shape) state.pos = {};
    state.shape = shape;
    place(positions(state.layout));
  }
  fit();
}

// Where every entry sits in one arrangement, worked out the first time that
// arrangement is shown in the current shape.
function positions(view) {
  const [areas, fold] = state.shape.split('/');
  state.pos[view] ??= view === 'tree' ? layoutTree(+fold) : layoutAreas(areas);
  return state.pos[view];
}

function place(pos) {
  for (const n of state.nodes) [n.x, n.y] = pos.get(n.id);
  moved();
}

function moved() {
  for (const a of state.areas) a.box = bounds(a.nodes);
  updatePositions();
}

// Switch between the tree and the areas. The entries glide to their new places.
function setLayout(view) {
  if (view === state.layout) return;
  finishWave();
  cancelAnimationFrame(state.tween);
  state.layout = view;
  for (const v of ['tree', 'areas']) {
    document.body.classList.toggle(`view-${v}`, v === view);
    $(`btn-${v}`).setAttribute('aria-pressed', String(v === view));
  }
  const to = positions(view);
  const box = bounds([...to.values()].map(([x, y]) => ({ x, y })));
  if (reduceMotion) {
    place(to);
    applyStatus();
    fitBox(box);
    return;
  }
  const from = new Map(state.nodes.map((n) => [n.id, [n.x, n.y]]));
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / 800);
    const e = d3.easeCubicInOut(p);
    for (const n of state.nodes) {
      const [ax, ay] = from.get(n.id);
      const [bx, by] = to.get(n.id);
      n.x = ax + (bx - ax) * e;
      n.y = ay + (by - ay) * e;
    }
    moved();
    positionLabels();
    state.tween = p < 1 ? requestAnimationFrame(step) : 0;
  };
  state.tween = requestAnimationFrame(step);
  applyStatus();
  fitBox(box, true, 800);
}

// The tree: axioms in the bottom row, and every entry one row above the
// highest thing it stands on. Within a row, an entry is placed near the
// average position of what it is linked to in the rows below and above; a few
// sweeps up and down settle the order. With `fold` above 1, a crowded row is
// folded into a zigzag of that many lines, so the tree gets narrower.
function layoutTree(fold) {
  const slot = 106;
  const gap = fold > 1 ? 104 : 128;
  const zig = 56;
  const rows = [];
  for (const n of state.nodes) (rows[n.layer] ??= []).push(n);
  const step = (row) => (row.length > 6 ? slot / fold : slot); // distance between neighbours in a row
  const x = new Map();
  const rank = new Map(); // position of an entry within its row, left to right
  // Start with the entries that carry most in the middle of their row, so the trunk grows straight up.
  for (const row of rows) {
    const heavy = [...row].sort((a, b) => b.above.size - a.above.size);
    heavy.forEach((n, i) => x.set(n.id, (i % 2 ? -1 : 1) * Math.ceil(i / 2) * step(row)));
  }

  const below = (n) => [...n.inputs, ...n.within];
  const above = (n) => [...state.dependents.get(n.id), ...state.built.get(n.id)];
  const both = (n) => [...below(n), ...above(n)];
  // Order a row by where each entry wants to be, then move entries apart just
  // enough that neighbours keep their distance (isotonic regression).
  const spread = (row, linked) => {
    const d = step(row);
    const order = row
      .map((n) => ({ n, was: x.get(n.id), want: d3.mean(linked(n), (id) => x.get(id)) ?? x.get(n.id) }))
      .sort((a, b) => a.want - b.want || a.was - b.was);
    const blocks = [];
    order.forEach((o, i) => {
      let b = { sum: o.want - i * d, n: 1 };
      while (blocks.length && blocks.at(-1).sum / blocks.at(-1).n > b.sum / b.n) {
        const prev = blocks.pop();
        b = { sum: prev.sum + b.sum, n: prev.n + b.n };
      }
      blocks.push(b);
    });
    let i = 0;
    for (const b of blocks) {
      for (let k = 0; k < b.n; k++, i++) {
        x.set(order[i].n.id, b.sum / b.n + i * d);
        rank.set(order[i].n.id, i);
      }
    }
  };
  for (let sweep = 0; sweep < 8; sweep++) {
    for (let i = 1; i < rows.length; i++) spread(rows[i], sweep ? both : below);
    for (let i = rows.length - 2; i >= 0; i--) spread(rows[i], both);
  }
  for (let i = 1; i < rows.length; i++) spread(rows[i], both);

  const pitch = gap + (fold - 1) * zig;
  const folded = (n) => (rows[n.layer].length > 6 ? (rank.get(n.id) % fold) * zig : 0);
  return new Map(state.nodes.map((n) => [n.id, [x.get(n.id), -n.layer * pitch - folded(n)]]));
}

// The areas, in two passes. First the areas are packed as circles sized by
// how many statements they hold, pulled into a tall, wide or flat arrangement.
// Then every statement is pulled towards its area's centre and along its links.
function layoutAreas(shape) {
  const [gx, gy] = { tall: [0.12, 0.03], wide: [0.04, 0.1], flat: [0.015, 0.22] }[shape];
  const blobs = [...state.areas]
    .sort((a, b) => b.nodes.length - a.nodes.length)
    .map((a, i) => ({ id: a.id, r: 46 * Math.sqrt(a.nodes.length) + 70, x: i ? Math.cos(i * 2.4) * 700 : 0, y: i ? Math.sin(i * 2.4) * 700 : 0 }));
  d3.forceSimulation(blobs)
    .force('collide', d3.forceCollide((d) => d.r + 10).strength(1).iterations(3))
    .force('x', d3.forceX(0).strength(gx))
    .force('y', d3.forceY(0).strength(gy))
    .stop()
    .tick(400);
  const centre = new Map(blobs.map((b) => [b.id, b]));

  const sim = state.nodes.map((n, i) => {
    const c = centre.get(n.area);
    const a = i * 2.399963; // golden angle, so the start is spread and repeatable
    const d = c.r * 0.7 * Math.sqrt(((i * 7) % 13 + 1) / 13);
    return { id: n.id, area: n.area, r: n.r, x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d };
  });
  const simLinks = state.links.map((l) => ({ source: l.source, target: l.target, type: l.type }));
  const sameArea = (l) => l.source.area === l.target.area;
  const firm = (l) => l.type === 'needs' || l.type === 'within';
  const fan = (d) => Math.sqrt(state.dependents.get(d.id).length + (d.area === 'foundations' ? state.built.get(d.id).filter((id) => node(id).area === d.area).length : 0));

  d3.forceSimulation(sim)
    .force(
      'link',
      d3
        .forceLink(simLinks)
        .id((d) => d.id)
        .distance((l) => (!firm(l) ? 120 : 62 + 30 * fan(l.source) + 20 * fan(l.target)))
        .strength((l) => (!sameArea(l) ? (l.type === 'within' ? 0.004 : 0.02) : l.type === 'within' ? 0.18 : !firm(l) ? 0.1 : 0.5)),
    )
    .force('charge', d3.forceManyBody().strength((d) => -400 - 90 * fan(d)).distanceMax(460))
    .force('collide', d3.forceCollide((d) => d.r + 36).strength(0.9).iterations(2))
    .force('x', d3.forceX((d) => centre.get(d.area).x).strength(0.075))
    .force('y', d3.forceY((d) => centre.get(d.area).y).strength(0.075))
    .stop()
    .tick(700);

  return new Map(sim.map((p) => [p.id, [p.x, p.y]]));
}

function bounds(nodes) {
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

function updatePositions() {
  for (const n of state.nodes) n.el.setAttribute('transform', `translate(${n.x},${n.y})`);
  for (const l of state.links) {
    const s = node(l.source);
    const t = node(l.target);
    l.line.attr('x1', s.x).attr('y1', s.y).attr('x2', t.x).attr('y2', t.y);
    const f = l.equivalent ? 0.5 : 0.58;
    const angle = (Math.atan2(t.y - s.y, t.x - s.x) * 180) / Math.PI;
    l.chev.attr('transform', `translate(${s.x + (t.x - s.x) * f},${s.y + (t.y - s.y) * f}) rotate(${angle})`);
  }
}

function moveTo(target, animate, duration = 450) {
  if (animate && !reduceMotion) svg.transition().duration(duration).call(zoom.transform, target);
  else svg.call(zoom.transform, target);
}

// Show all of `nodes` (the whole graph by default) in the free part of the window.
function fit(animate = false, nodes = state.nodes) {
  fitBox(bounds(nodes), animate);
}

function fitBox({ x0, x1, y0, y1 }, animate = false, duration) {
  const area = freeArea();
  const padX = Math.min(62, window.innerWidth * 0.08);
  const padTop = Math.min(40, (area.bottom - area.top) * 0.12);
  const padBottom = Math.min(44, (area.bottom - area.top) * 0.14);
  const k = Math.min((area.right - area.left - 2 * padX) / (x1 - x0 || 1), (area.bottom - area.top - padTop - padBottom) / (y1 - y0 || 1), 1.3);
  const tx = (area.left + area.right) / 2 - (k * (x0 + x1)) / 2;
  const ty = (area.top + padTop + area.bottom - padBottom) / 2 - (k * (y0 + y1)) / 2;
  moveTo(d3.zoomIdentity.translate(tx, ty).scale(k), animate, duration);
}

// Bring one node to the middle of the free part, zoomed in enough to read around it.
function centreOn(n) {
  const area = freeArea();
  const k = Math.max(state.t.k, 0.85);
  moveTo(d3.zoomIdentity.translate((area.left + area.right) / 2 - k * n.x, (area.top + area.bottom) / 2 - k * n.y).scale(k), true);
}

// Pan just enough that a node is not hidden behind the header or the panel.
function ensureVisible(n) {
  const area = freeArea();
  const box = { left: area.left + 44, right: area.right - 44, top: area.top + 30, bottom: area.bottom - 50 };
  const [x, y] = state.t.apply([n.x, n.y]);
  const dx = Math.max(box.left, Math.min(box.right, x)) - x;
  const dy = Math.max(box.top, Math.min(box.bottom, y)) - y;
  if (dx || dy) svg.transition().duration(reduceMotion ? 0 : 350).call(zoom.translateBy, dx / state.t.k, dy / state.t.k);
}

function onZoom(e) {
  state.t = e.transform;
  viewport.attr('transform', e.transform);
  svg.node().style.setProperty('--ns', Math.pow(e.transform.k, -0.5));
  positionLabels();
}

const screenR = (n) => n.r * Math.sqrt(state.t.k);

// Labels keep a fixed size on screen. Where two would collide, the less
// important one is hidden until the reader zooms in, hovers or selects it.
function positionLabels() {
  const sel = state.selected;
  const near = sel ? neighbours(sel) : new Set();
  const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
  const placed = [];

  // Area names head the clusters; in the tree the areas are interleaved, so they are not shown.
  for (const a of state.layout === 'areas' ? state.areas : []) {
    const [x, y] = state.t.apply([(a.box.x0 + a.box.x1) / 2, a.box.y0]);
    const top = y - 40;
    const w = a.labelEl.getBBox().width; // differs by screen size, so measured
    a.labelEl.setAttribute('transform', `translate(${x},${top})`);
    placed.push([x - w / 2, top, x + w / 2, top + 18]);
  }

  const rank = (n) =>
    (n.id === state.hover ? 100000 : 0) +
    (n.id === sel ? 50000 : 0) +
    (state.trace?.origin === n.id ? 50000 : 0) +
    (n.hub ? 10000 : 0) +
    (n.kind === 'system' ? (state.layout === 'tree' ? 12000 : 3000) + n.above.size : 0) +
    (near.has(n.id) ? 4000 : 0) +
    (state.trace?.seen.has(n.id) ? 20000 : 0) +
    (n.kind !== 'theorem' ? 100 : 0) +
    n.weight * 10;
  const order = [...state.nodes].sort((a, b) => rank(b) - rank(a));
  const dots = state.nodes.map((n) => {
    const [x, y] = state.t.apply([n.x, n.y]);
    const r = screenR(n);
    return { id: n.id, box: [x - r, y - r, x + r, y + r] };
  });
  for (const n of order) {
    const [x, y] = state.t.apply([n.x, n.y]);
    const h = n.lines.length * (n.big ? 15 : 13) + 2;
    const forced = n.id === state.hover || n.id === sel || state.trace?.origin === n.id;
    const boxAt = (top) => [x - n.labelW / 2 - 2, top, x + n.labelW / 2 + 2, top + h];
    // The most rested-on statements, the systems and whatever a trace has lit may sit on top of neighbouring dots; they only give way to other labels.
    const loud = n.big || state.trace?.seen.has(n.id);
    const clear = (top) => (placed.some((b) => hit(boxAt(top), b)) ? null : boxAt(top));
    const free = (top) => (dots.some((d) => d.id !== n.id && hit(boxAt(top), d.box)) ? null : clear(top));
    const below = y + screenR(n) + 4;
    const above = y - screenR(n) - 4 - h;
    const box = free(below) || free(above) || (loud ? clear(below) || clear(above) : null) || (forced ? boxAt(below) : null);
    const top = box ? box[1] : below;
    n.labelEl.setAttribute('transform', `translate(${x},${top})`);
    n.labelEl.classList.toggle('hidden', !box);
    if (box) placed.push(box);
  }
}

/* ---------- state ---------- */

function neighbours(id) {
  const n = node(id);
  const out = new Set([id, ...n.inputs, ...n.within, ...n.related, ...n.formerly, ...state.dependents.get(id), ...state.built.get(id)]);
  for (const l of state.links) if (l.source === id) out.add(l.target);
  return out;
}

// What counts as holding without any what-if: today's proof in "Today", and
// the axioms assumed by default unless the reader dropped them.
function baseMarks() {
  const ids = new Set(state.index.assumed.filter((id) => !state.dropped.has(id)));
  if (state.mode === 'today') for (const id of state.index.today.proven) ids.add(id);
  return ids;
}

function litFor(shown) {
  return new Set(state.links.filter((l) => l.type === 'needs' && shown.has(l.source)).map((l) => l.key));
}

// Recompute what holds and move the picture there. A change in one direction
// (only gains or only losses) is played as a wave; anything else is applied at once.
function go({ animate }) {
  finishWave();
  state.trace = null;
  const real = computeProven(state.nodes, baseMarks());
  const after = computeProven(state.nodes, new Set([...baseMarks(), ...state.whatIf]));
  const before = state.shown;
  const gains = [...after].some((id) => !before.has(id));
  const losses = [...before].some((id) => !after.has(id));
  const wave = animate && !reduceMotion && gains !== losses;
  // While a withdrawal spreads, nodes it has not reached yet keep their old colour.
  if (!(wave && losses)) state.real = real;
  if (wave) {
    applyStatus();
    if (gains) proveWave(before, after);
    else loseWave(before, after, real);
  } else {
    state.shown = after;
    state.lit = litFor(after);
    applyStatus();
  }
  $('btn-reset').hidden = state.whatIf.size + state.dropped.size === 0;
  renderStatusLine();
  renderPanel();
}

function setMode(mode) {
  state.mode = mode;
  state.whatIf.clear();
  state.dropped.clear();
  $('btn-before').setAttribute('aria-pressed', String(mode === 'before'));
  $('btn-today').setAttribute('aria-pressed', String(mode === 'today'));
  go({ animate: mode === 'today' });
}

function toggle(set, id) {
  if (set.has(id)) set.delete(id);
  else set.add(id);
  state.focus = false; // show the whole graph while the change spreads
  go({ animate: true });
}

function applyStatus() {
  const sel = state.selected;
  const trace = state.trace;
  const near = sel && state.focus && !trace ? neighbours(sel) : null;
  const dimNode = (id) => (trace ? id !== trace.origin && !trace.seen.has(id) : !!near && !near.has(id));
  for (const n of state.nodes) {
    const st = statusOf(n);
    for (const dom of [n.el, n.labelEl]) {
      const cl = dom.classList;
      cl.toggle('st-proven', st === 'proven');
      cl.toggle('st-conditional', st === 'conditional');
      cl.toggle('st-open', st === 'open');
      cl.toggle('whatif', isHypothetical(n.id));
      cl.toggle('dim', dimNode(n.id));
      cl.toggle('traced', !!trace && (trace.seen.has(n.id) || trace.origin === n.id));
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
    const traced = !!trace && trace.edges.has(l.key);
    cl.toggle('on', on);
    cl.toggle('waiting', l.type === 'needs' && !on && !state.shown.has(l.target));
    cl.toggle('whatif', on && !state.real.has(l.source));
    cl.toggle('traced', traced);
    cl.toggle('own', l.type === 'within' && (l.source === sel || l.target === sel));
    cl.toggle('dim', trace ? !traced : !!near && l.source !== sel && l.target !== sel);
  }
  renderTally();
}

function renderTally() {
  const count = { proven: 0, whatif: 0, conditional: 0, open: 0 };
  for (const n of state.nodes.filter(isStatement)) count[isHypothetical(n.id) ? 'whatif' : statusOf(n)]++;
  const chip = (key, label) => el('span', { class: `t-${key}` }, el('i'), el('b', { text: String(count[key]) }), label);
  $('tally').replaceChildren(
    ...[chip('proven', 'proven'), count.whatif ? chip('whatif', 'what-if') : null, chip('conditional', 'conditional'), chip('open', 'open')].filter(Boolean),
  );
}

function renderStatusLine() {
  const line = $('status-line');
  const changed = state.whatIf.size + state.dropped.size > 0;
  line.classList.toggle('today', state.mode === 'today' && !changed);
  line.classList.toggle('whatif', changed);
  if (changed) {
    const parts = [];
    if (state.whatIf.size) parts.push(`treating ${listNames([...state.whatIf])} as true`);
    if (state.dropped.size) parts.push(`not assuming ${listNames([...state.dropped])}`);
    const text = andList.format(parts);
    line.replaceChildren(el('strong', { text: 'What-if. ' }), `${text[0].toUpperCase()}${text.slice(1)}. This is your experiment, not the state of mathematics.`);
  } else if (state.mode === 'today') {
    line.replaceChildren(el('strong', { text: 'The Riemann Hypothesis is proven. ' }), state.index.today.status);
  } else {
    const waiting = state.nodes.filter((n) => statusOf(n) === 'conditional').length;
    line.replaceChildren(
      el('strong', { text: 'Before 20 Nov 2026. ' }),
      `The Riemann Hypothesis is open. ${waiting} statements on this map hold only if an unproven hypothesis is true.`,
    );
  }
}

/* ---------- waves ---------- */

// One animation serves every kind of spreading change. From the `seeds`, a
// ring expands; each node in `order` (pairs of id and ring number) is reached
// when the ring gets to it, but never before the nodes it follows from
// (`parents`). `flows` are the links the change travels along.
function runWave({ seeds, order, parents, flows, cls, onReach, onFlowDone, onDone }) {
  const fromSeed = (n) => Math.min(...seeds.map((s) => Math.hypot(n.x - s.x, n.y - s.y)));
  const maxDist = Math.max(140, ...order.map(([id]) => fromSeed(node(id))));
  const speed = maxDist / 2200; // graph units per millisecond
  const seedIds = new Set(seeds.map((s) => s.id));

  const at = new Map();
  for (const [id] of [...order].sort((a, b) => a[1] - b[1])) {
    if (seedIds.has(id)) {
      at.set(id, 0);
      continue;
    }
    const earlier = parents(id).map((p) => at.get(p)).filter((time) => time !== undefined);
    at.set(id, Math.max(150 + fromSeed(node(id)) / speed, Math.max(0, ...earlier) + 260));
  }

  const drawn = flows.map(({ from, to, link }) => {
    const start = at.get(from.id) ?? 0;
    const end = at.has(to.id) ? Math.max(at.get(to.id), start + 120) : start + Math.min(900, Math.max(300, Math.hypot(to.x - from.x, to.y - from.y) / speed));
    const g = gFlows.append('g').attr('class', `flow ${cls}`).style('display', 'none');
    const line = g.append('line').attr('x1', from.x).attr('y1', from.y);
    const dot = g.append('circle').attr('r', 3.5 / state.t.k);
    return { link, from, to, start, end, g, line, dot, done: false };
  });

  const reachR = maxDist + 110;
  const rings = seeds.flatMap((s) =>
    [0, 280, 560].map((delay, i) => ({
      delay,
      alpha: 0.75 - i * 0.2,
      el: gWaves.append('circle').attr('class', `wave ${cls}`).attr('cx', s.x).attr('cy', s.y).attr('stroke-width', 2.5 - i * 0.7).style('display', 'none'),
    })),
  );

  const events = [...at].map(([id, time]) => ({ id, time })).sort((a, b) => a.time - b.time);
  const end = Math.max(...events.map((e) => e.time), ...drawn.map((f) => f.end), 560 + reachR / speed) + 150;
  const wave = { flows: drawn, rings, raf: 0, onDone };
  state.wave = wave;
  let next = 0;
  const t0 = performance.now();

  const frame = (now) => {
    const t = now - t0;
    let dirty = false;

    for (const w of rings) {
      const r = (t - w.delay) * speed;
      const visible = r > 0 && r < reachR;
      w.el.style('display', visible ? null : 'none');
      if (visible) w.el.attr('r', r).attr('opacity', w.alpha * (1 - r / reachR));
    }

    for (const f of drawn) {
      if (f.done || t < f.start) continue;
      const p = Math.min(1, (t - f.start) / (f.end - f.start));
      const x = f.from.x + (f.to.x - f.from.x) * p;
      const y = f.from.y + (f.to.y - f.from.y) * p;
      f.g.style('display', null);
      f.line.attr('x2', x).attr('y2', y);
      f.dot.attr('cx', x).attr('cy', y);
      if (p >= 1) {
        f.done = true;
        f.g.remove();
        onFlowDone?.(f.link);
        dirty = true;
      }
    }

    while (next < events.length && events[next].time <= t) {
      const e = events[next++];
      onReach(e.id);
      dirty = true;
      if (e.id === state.selected) renderPanel();
    }

    if (dirty) {
      applyStatus();
      if (state.trace) positionLabels();
    }
    if (t < end) wave.raf = requestAnimationFrame(frame);
    else finishWave();
  };
  wave.raf = requestAnimationFrame(frame);
}

function finishWave() {
  const wave = state.wave;
  if (!wave) return;
  cancelAnimationFrame(wave.raf);
  wave.flows.forEach((f) => f.g.remove());
  wave.rings.forEach((w) => w.el.remove());
  state.wave = null;
  wave.onDone();
  applyStatus();
  positionLabels();
  renderPanel();
}

function pulse(dom, cls) {
  dom.classList.remove('flip', 'denied', 'ping');
  dom.getBoundingClientRect(); // restart the CSS animation
  dom.classList.add(cls);
  setTimeout(() => dom.classList.remove(cls), 1000);
}

// Statements become proven (or assumed): green, or blue for a what-if.
function proveWave(before, after) {
  const { flipped, touched } = rippleOrder(state.nodes, before, after);
  const seeds = [...flipped].filter(([, depth]) => depth === 0).map(([id]) => node(id));
  runWave({
    seeds,
    order: [...flipped, ...touched],
    parents: (id) => node(id).inputs.filter((p) => flipped.has(p)),
    flows: state.links.filter((l) => l.type === 'needs' && flipped.has(l.source)).map((l) => ({ from: node(l.source), to: node(l.target), link: l })),
    cls: seeds.some((s) => !state.real.has(s.id)) ? 'whatif' : '',
    onReach: (id) => {
      if (flipped.has(id)) state.shown.add(id);
      pulse(node(id).el, flipped.has(id) ? 'flip' : 'denied');
    },
    onFlowDone: (l) => state.lit.add(l.key),
    onDone: () => {
      state.shown = after;
      state.lit = litFor(after);
    },
  });
}

// An assumption is withdrawn: everything that rested on it turns conditional.
function loseWave(before, after, real) {
  const { flipped: lost } = rippleOrder(state.nodes, after, before);
  runWave({
    seeds: [...lost].filter(([, depth]) => depth === 0).map(([id]) => node(id)),
    order: [...lost],
    parents: (id) => node(id).inputs.filter((p) => lost.has(p)),
    flows: state.links.filter((l) => l.type === 'needs' && lost.has(l.source) && lost.has(l.target)).map((l) => ({ from: node(l.source), to: node(l.target), link: l })),
    cls: 'amber',
    onReach: (id) => {
      state.shown.delete(id);
      state.lit = litFor(state.shown);
      pulse(node(id).el, 'denied');
    },
    onDone: () => {
      state.real = real;
      state.shown = after;
      state.lit = litFor(after);
    },
  });
}

// "What rests on this" (down) and "What this rests on" (up): nothing changes,
// the wave only lights up the part of the network that is connected. Two more
// directions also follow the systems an entry is built in: 'roots' goes down
// to the axioms, 'above' shows everything that stands on a system or an axiom.
function startTrace(id, dir) {
  finishWave();
  const origin = node(id);
  const members = origin[dir];
  const all = dir === 'roots' || dir === 'above';
  const outward = dir === 'down' || dir === 'above'; // the wave runs away from the axioms
  const inside = (x) => x === id || members.has(x);
  const trace = { origin: id, dir, seen: new Set(), edges: new Set() };
  const links = state.links.filter((l) => (l.type === 'needs' || (all && l.type === 'within')) && inside(l.source) && inside(l.target));
  const below = (x) => (all ? [...node(x).inputs, ...node(x).within] : node(x).inputs);
  const over = (x) => (all ? [...state.dependents.get(x), ...state.built.get(x)] : state.dependents.get(x));
  const finish = () => {
    trace.seen = new Set(members.keys());
    trace.edges = new Set(links.map((l) => l.key));
  };
  state.trace = trace;
  state.focus = false;
  applyStatus();
  renderPanel();
  if (reduceMotion) {
    finish();
    applyStatus();
    positionLabels();
    return;
  }
  runWave({
    seeds: [origin],
    order: [[id, 0], ...members],
    parents: (x) => (outward ? below(x) : over(x)).filter(inside),
    flows: links.map((l) => (outward ? { from: node(l.source), to: node(l.target), link: l } : { from: node(l.target), to: node(l.source), link: l })),
    cls: 'trace',
    onReach: (x) => {
      if (x === id) return;
      trace.seen.add(x);
      pulse(node(x).el, 'ping');
    },
    onFlowDone: (l) => trace.edges.add(l.key),
    onDone: finish,
  });
  fit(true, [origin, ...[...members.keys()].map(node)]);
}

function clearTrace() {
  if (!state.trace) return;
  finishWave();
  state.trace = null;
}

/* ---------- panel ---------- */

function select(id, { centre = false } = {}) {
  clearTrace();
  state.selected = id;
  state.view = 'node';
  state.focus = !!id;
  applyStatus();
  renderPanel();
  positionLabels();
  if (!id) return;
  if (centre) centreOn(node(id));
  else ensureVisible(node(id));
}

function refList(ids, extra = () => null) {
  return el(
    'ul',
    { class: 'reflist' },
    ...ids.map((id) => {
      const n = node(id);
      const dot = el('span', { class: `dot ${statusOf(n)}${isHypothetical(id) ? ' whatif' : ''}${n.kind === 'axiom' ? ' axiom' : ''}` });
      return el('li', {}, el('button', { type: 'button', onclick: () => select(id, { centre: true }) }, dot, el('span', { text: n.name })), extra(id));
    }),
  );
}

function explain(n) {
  const today = state.index.today;
  const holds = state.shown.has(n.id);
  if (n.kind === 'system') return `A number system or a theory, not a statement, so it is neither proven nor open. ${n.above.size === 1 ? '1 entry on this map is' : `${n.above.size} entries on this map are`} built on it, directly or through others.`;
  if (n.kind === 'axiom') {
    if (state.whatIf.has(n.id)) return 'You chose to assume this to see what would follow. It is not one of the axioms assumed by default.';
    if (holds && !n.weight) return 'An axiom of Zermelo–Fraenkel set theory: assumed, not proven. Everything on this map is built on these axioms.';
    if (holds) return 'An axiom: it cannot be proven from the other axioms, and most of mathematics assumes it. Stop assuming it to see what depends on it.';
    if (state.dropped.has(n.id)) return 'You stopped assuming this axiom. Everything that needs it is now shown as conditional.';
    return 'An axiom that can be neither proven nor refuted from the standard axioms. It is not assumed by default.';
  }
  if (n.base === 'proven') return n.needs.length ? `Proven. The cited proof rests on ${listNames(n.needs)}.` : 'Proven. No other statement on this map is recorded as needed for its proof.';
  const met = n.inputs.filter((id) => state.shown.has(id)); // the requirements that hold right now
  if (state.whatIf.has(n.id)) return 'You marked this as proven to see what would follow. It is still open.';
  if (holds && state.mode === 'today' && today.proven.includes(n.id)) return today.status;
  if (holds) {
    const axioms = met.filter((id) => node(id).kind === 'axiom');
    if (isHypothetical(n.id)) return `Would hold in your what-if, because ${listNames(met)} would.`;
    if (axioms.length) return `Proven, given ${listNames(axioms)}, which ${axioms.length > 1 ? 'are' : 'is'} assumed.`;
    return `Proven, because ${listNames(met)} ${met.length > 1 ? 'are' : 'is'} proven.`;
  }
  const missing = missingFor(state.nodes, state.shown, n.id);
  if (n.base === 'conditional') return `Proven only on condition. Still needs: ${listNames(missing)}.`;
  if (today.claimed.includes(n.id)) return `Open. ${today.claimedNote}`;
  return missing.length && !isRoot(state.nodes, n.id) ? `Open. Would follow from ${listNames(missing)}.` : 'Open.';
}

function renderPanel() {
  const panel = $('panel');
  const n = state.view === 'node' && state.selected ? node(state.selected) : null;
  const open = !!n || state.view === 'rankings';
  panel.hidden = !open;
  document.body.classList.toggle('panel-open', open);
  document.body.classList.toggle('tracing', !!state.trace);
  $('btn-rankings').setAttribute('aria-pressed', String(state.view === 'rankings'));
  if (!open) return;
  const key = n ? n.id : 'rankings';
  const scroll = panel.dataset.key === key ? panel.scrollTop : 0;
  const close = el('button', { class: 'close', type: 'button', 'aria-label': 'Close', onclick: closePanel, text: '✕' });
  panel.replaceChildren(close, ...(n ? nodeView(n) : rankingsView()).filter(Boolean));
  panel.dataset.key = key;
  panel.scrollTop = scroll;
}

function closePanel() {
  state.view = 'node';
  select(null);
}

function nodeView(n) {
  const st = statusOf(n);
  const hypo = isHypothetical(n.id);
  const axiom = n.kind === 'axiom';
  const system = n.kind === 'system';
  const kind = { hypothesis: 'Hypothesis', theorem: 'Result', data: 'Computed data', axiom: 'Axiom', system: 'Number system or theory' }[n.kind];
  const stLabel = axiom
    ? st === 'proven' ? (hypo ? 'Assumed in what-if' : 'Assumed') : 'Not assumed'
    : hypo ? 'Proven in what-if' : { proven: 'Proven', conditional: 'Conditional', open: 'Open' }[st];
  const area = state.areas.find((a) => a.id === n.area);
  const today = state.index.today;
  const section = (title, ids, extra) => (ids.length ? [el('h3', { text: title }), refList(ids, extra)] : []);
  const host = (url) => new URL(url).hostname.replace(/^(www|en)\./, '');
  const linkSource = (id) => (n.needUrl[id] ? el('a', { class: 'why', href: n.needUrl[id], target: '_blank', rel: 'noopener', title: 'Source for this link', text: 'source' }) : null);
  const sources = [{ title: host(n.url), url: n.url }, ...(n.id === 'rh' || today.claimed.includes(n.id) ? today.sources : [])];

  const tracing = state.trace?.origin === n.id ? state.trace.dir : null;
  const traceBtn = (dir, count, lead, tail) =>
    count
      ? el('button', { class: `trace-btn${tracing === dir ? ' active' : ''}`, type: 'button', onclick: () => (tracing === dir ? (clearTrace(), select(n.id)) : startTrace(n.id, dir)) }, lead, el('b', { text: String(count) }), tail)
      : null;

  // Only an axiom that statements are recorded as needing can be switched off:
  // nothing would change on the map for the others.
  const isDefault = state.index.assumed.includes(n.id) && n.weight > 0;
  let action = null;
  if (isDefault) {
    const off = state.dropped.has(n.id);
    action = el('button', { class: `whatif-btn${off ? '' : ' amber'}`, type: 'button', text: off ? 'Assume this again' : 'Stop assuming this', onclick: () => toggle(state.dropped, n.id) });
  } else if (state.whatIf.has(n.id) || (isRoot(state.nodes, n.id) && !state.shown.has(n.id) && !state.wave)) {
    const label = state.whatIf.has(n.id) ? 'Undo this what-if' : axiom ? 'What if we assume this?' : 'What if this is proven?';
    action = el('button', { class: 'whatif-btn', type: 'button', text: label, onclick: () => toggle(state.whatIf, n.id) });
  }

  return [
    el(
      'div',
      { class: 'badges' },
      el('span', { class: 'badge', text: kind }),
      system ? null : el('span', { class: `badge ${hypo ? 'whatif' : st}`, text: stLabel }),
      el('span', { class: 'badge', text: area.name }),
    ),
    el('h2', { text: n.name }),
    el('p', { class: 'statement', text: n.statement }),
    n.by ? el('p', { class: 'by', text: n.by }) : null,
    el('p', { class: 'explain', text: explain(n) }),
    n.claim ? el('p', { class: 'claim' }, el('strong', { text: 'Unreviewed claim. ' }), n.claim) : null,
    n.equivalent ? el('p', { class: 'explain', text: `Equivalent to ${listNames(n.needs)}: each implies the other.` }) : null,
    n.note ? el('p', { class: 'note', text: n.note }) : null,
    n.above.size + n.roots.size
      ? el(
          'div',
          { class: 'trace-row' },
          traceBtn('down', n.weight, '', n.weight === 1 ? ' statement rests on this' : ' statements rest on this'),
          traceBtn('up', n.up.size, 'This rests on ', n.up.size === 1 ? ' statement' : ' statements'),
          // Everything that stands on a system or an axiom, where that is more than the statements that need it.
          traceBtn('above', n.above.size > n.weight ? n.above.size : 0, '', n.above.size === 1 ? ' entry is built on this' : ' entries are built on this'),
          traceBtn('roots', n.roots.size > n.up.size ? n.roots.size : 0, 'Down to the axioms: ', n.roots.size === 1 ? ' step' : ' entries'),
        )
      : null,
    action,
    ...section(n.base === 'open' ? 'Would follow from' : 'Rests on', n.needs, linkSource),
    ...section('Would follow from any one of', n.anyOf, linkSource),
    ...section('Built within', n.within, linkSource),
    ...section('First proven assuming', n.formerly),
    ...section('Related', n.related),
    ...section('What rests on it directly', state.dependents.get(n.id)),
    ...section('Built directly on it', state.built.get(n.id)),
    el('h3', { text: 'Sources' }),
    el('ul', { class: 'links' }, ...sources.map((s) => el('li', {}, el('a', { href: s.url, target: '_blank', rel: 'noopener', text: s.title })))),
  ];
}

function rankingsView() {
  const top = (nodes, value) => nodes.filter((n) => value(n) > 0).sort((a, b) => value(b) - value(a) || a.name.localeCompare(b.name)).slice(0, 8);
  const list = (nodes, text) =>
    el(
      'ol',
      { class: 'ranking' },
      ...nodes.map((n) =>
        el(
          'li',
          {},
          el(
            'button',
            { type: 'button', onclick: () => select(n.id, { centre: true }) },
            el('span', { class: `dot ${statusOf(n)}${isHypothetical(n.id) ? ' whatif' : ''}${n.kind === 'axiom' ? ' axiom' : ''}` }),
            el('span', { class: 'r-name', text: n.name }),
            el('span', { class: 'r-num', text: text(n) }),
          ),
        ),
      ),
    );
  const proven = state.nodes.filter((n) => state.real.has(n.id) && n.kind !== 'axiom');
  const unproven = state.nodes.filter((n) => isRoot(state.nodes, n.id) && (n.kind === 'axiom' || !state.real.has(n.id)));
  const rests = (n) => `${n.weight} ${n.weight === 1 ? 'rests' : 'rest'} on it`;
  return [
    el('h2', { text: 'Rankings' }),
    el('p', { class: 'note', text: 'Counted on this map only. A statement rests on another directly or through a chain of other statements.' }),
    el('h3', { text: 'Proven foundations: most rests on them' }),
    list(top(proven, (n) => n.weight), rests),
    el('h3', { text: 'Unproven or assumed, yet most rests on them' }),
    list(top(unproven, (n) => n.weight), rests),
    el('h3', { text: 'Longest chains of results' }),
    list(top(state.nodes, (n) => n.depth), (n) => plural(n.depth, 'step')),
  ];
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

function wireSearch() {
  const input = $('search');
  const list = $('search-results');
  let matches = [];
  const pick = (n) => {
    input.value = '';
    list.hidden = true;
    input.blur();
    select(n.id, { centre: true });
  };
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    const starts = (n) => (n.name.toLowerCase().startsWith(q) || n.short.toLowerCase().startsWith(q) ? 1 : 0);
    matches = q ? state.nodes.filter((n) => `${n.name} ${n.short}`.toLowerCase().includes(q)).sort((a, b) => starts(b) - starts(a) || b.weight - a.weight).slice(0, 8) : [];
    list.hidden = !q;
    list.replaceChildren(
      ...(matches.length
        ? matches.map((n) => el('li', {}, el('button', { type: 'button', onclick: () => pick(n) }, el('span', { class: `dot ${statusOf(n)}` }), el('span', { text: n.name }))))
        : [el('li', { class: 'none', text: 'Nothing on this map matches.' })]),
    );
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && matches.length) pick(matches[0]);
    if (e.key === 'Escape') {
      input.value = '';
      list.hidden = true;
      input.blur();
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.search')) list.hidden = true;
  });
}

function wire() {
  svg.on('click', (e) => {
    state.touched = true;
    const n = nodeAt(e.clientX, e.clientY);
    if (n) select(n.id);
    else if (state.view === 'node') select(null);
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
  const touch = (fn) => () => {
    state.touched = true;
    fn();
  };
  $('btn-before').addEventListener('click', touch(() => setMode('before')));
  $('btn-today').addEventListener('click', touch(() => setMode('today')));
  $('btn-replay').addEventListener(
    'click',
    touch(() => {
      setMode('before');
      setTimeout(() => setMode('today'), 500);
    }),
  );
  $('btn-reset').addEventListener('click', () => {
    state.whatIf.clear();
    state.dropped.clear();
    go({ animate: false });
  });
  $('btn-rankings').addEventListener(
    'click',
    touch(() => {
      if (state.view === 'rankings') return closePanel();
      clearTrace();
      state.selected = null;
      state.view = 'rankings';
      applyStatus();
      renderPanel();
    }),
  );
  $('btn-all').addEventListener('click', touch(() => fit(true)));
  $('btn-tree').addEventListener('click', touch(() => setLayout('tree')));
  $('btn-areas').addEventListener('click', touch(() => setLayout('areas')));
  $('status-line').addEventListener('click', () => select('rh', { centre: true }));
  wireSearch();
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.activeElement !== $('search')) closePanel();
  });
  let timer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(relayout, 150);
  });
}
