import { normalize, validate, computeProven, isRoot, missingFor, waitsOn, rippleOrder, reachFrom, layers, homes, foundationsOf, restsOn, followsFrom, bridges } from './propagate.js';

const d3 = window.d3;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (id) => document.getElementById(id);
const andList = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

const state = {
  index: null, // data/index.json: areas, the "today" event, axioms assumed by default
  nodes: [],
  byId: new Map(),
  links: [],
  dependents: new Map(), // id -> the statements that rest on it: their proof uses or assumes it
  follows: new Map(), // id -> the open statements that would follow from it
  built: new Map(), // id -> the entries built directly within it (systems and axioms)
  around: new Map(), // id -> the entries whose home it is: of all they stand on, this is the highest. The molecule puts them around it.
  inBall: new Map(), // subject -> the entries that lie inside its ball in the molecule: the statements at it that nothing rests on
  middle: null, // set theory, the one subject that stands on axioms alone
  areas: [],
  layout: 'tree', // how the map is arranged: 'tree' (axioms at the bottom), 'molecule' (the subjects as atoms, joined by bonds) or 'areas' (one cloud per data file)
  pos: {}, // positions per arrangement for the current shape, worked out when first shown
  levels: {}, // per arrangement: the zoom from which each entry is drawn
  order: [], // all entries, the ones most is built on first
  bridges: [], // links drawn past entries that are hidden at this zoom
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
  dotScale: 'scale(1)', // dots shrink and grow with the zoom, by its square root
};

const svg = d3.select('#graph');
// The graph is built outside the page and put in at the end of init(): the
// browser then styles and lays out its 4,000 elements once, in their final state.
const viewport = d3.create('svg:g').attr('class', 'viewport');
const gWaves = viewport.append('g');
const gBridges = viewport.append('g').attr('class', 'bridges');
const gEdges = viewport.append('g');
const gBalls = viewport.append('g'); // over the lines, so that a line ends at the rim of a ball
const gFlows = viewport.append('g');
const gNodes = viewport.append('g');
const gAreas = d3.create('svg:g');
const gLabels = d3.create('svg:g');
const maxZoom = 5;
const labelRoom = [104, 52]; // room on screen for a dot with its label
const zoom = d3.zoom().scaleExtent([0.12, maxZoom]).on('zoom', onZoom);

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
    state.follows.set(n.id, []);
    state.built.set(n.id, []);
    state.around.set(n.id, []);
  }
  const home = homes(nodes);
  for (const n of nodes) {
    n.home = home.get(n.id);
    if (n.home) state.around.get(n.home).push(n.id);
  }
  // For the molecule. A subject is a number system or a theory. The statements at a subject that nothing rests on
  // lie inside its ball (`ballOf`); the axioms lie inside the ball of set theory, the ones it is built on innermost.
  state.middle = nodes.find((n) => !n.home && n.kind !== 'axiom');
  for (const n of nodes) {
    const plain = n.kind !== 'system' && n.home && state.byId.get(n.home).kind === 'system' && !state.around.get(n.id).length;
    n.ballOf = plain ? n.home : n.kind === 'axiom' ? state.middle.id : null;
    if (n.kind === 'system') state.inBall.set(n.id, []);
  }
  for (const n of [...nodes].sort((a, b) => Number(b.kind === 'axiom') - Number(a.kind === 'axiom') || Number(state.middle.within.includes(b.id)) - Number(state.middle.within.includes(a.id)))) {
    if (n.ballOf) state.inBall.get(n.ballOf).push(n.id);
  }
  for (const n of nodes) if (n.kind === 'system') n.ball = ballRadius(state.inBall.get(n.id).length);
  for (const n of nodes) {
    n.inputs = [...n.needs, ...n.anyOf]; // everything it is linked to upstream: a change of status travels along all of these
    n.rests = restsOn(n); // the part of them it rests on. An open statement rests on nothing: it would follow from what it lists.
    const loose = new Set(followsFrom(n));
    for (const [type, refs] of [['needs', n.inputs], ['within', n.within], ['related', n.related], ['formerly', n.formerly]]) {
      for (const ref of refs) {
        const inner = type === 'within' && state.byId.get(ref).area === n.area; // both ends in the same area
        // `follows`: a 'needs' link of the "would follow from" kind. It is drawn dashed and left out of the tree's rows, the traces and the counts.
        // `bond`: the line from an entry to its home, unless the entry lies inside its home's ball. The molecule draws only these.
        // `stem`: such a line between two subjects.
        const bond = ref === n.home && !n.ballOf && type !== 'related' && type !== 'formerly';
        const stem = bond && n.kind === 'system';
        state.links.push({ source: ref, target: n.id, type, inner, bond, stem, follows: type === 'needs' && loose.has(ref), key: `${type === 'within' ? 'in:' : ''}${ref}>${n.id}`, equivalent: type === 'needs' && !!n.equivalent });
      }
    }
    for (const need of n.rests) state.dependents.get(need).push(n.id);
    for (const from of loose) state.follows.get(from).push(n.id);
    for (const sys of n.within) state.built.get(sys).push(n.id);
  }
  const layer = layers(nodes);
  const [down, up, roots, above] = [reachFrom(nodes, 'down'), reachFrom(nodes, 'up'), reachFrom(nodes, 'up', foundationsOf), reachFrom(nodes, 'down', foundationsOf)];
  nodes.forEach((n, i) => {
    n.i = i;
    n.down = down(n.id); // what rests on it
    n.up = up(n.id); // what it rests on
    n.roots = roots(n.id); // the same, plus the systems it is built in, down to the axioms
    n.above = above(n.id); // everything that stands on it in any way
    n.weight = n.down.size;
    n.depth = Math.max(0, ...n.up.values());
    n.layer = layer.get(n.id); // height above the axioms
    n.r = n.kind === 'system' ? Math.min(22, 9 + 0.9 * Math.sqrt(n.above.size)) : Math.min(24, 8 + 2.3 * Math.sqrt(n.weight)) + (n.kind === 'theorem' ? 0 : 1.5);
  });
  // The most rested-on statements keep their label at every zoom level, and so do the systems.
  [...nodes].sort((a, b) => b.weight - a.weight).slice(0, 12).forEach((n) => (n.hub = n.weight >= 4));
  for (const n of nodes) n.big = !!n.hub || n.kind === 'system';
  // Zoomed out, only the entries most is built on are drawn. Among entries nothing is built on, the ones that stand on most come first.
  // An axiom counts by the statements that need it, so that set theory itself is drawn before the eight axioms right below it.
  const major = (n) => (n.kind === 'axiom' ? n.weight : n.above.size);
  state.order = [...nodes].sort((a, b) => major(b) - major(a) || b.roots.size - a.roots.size);
  state.areas = index.areas.map((a) => ({ ...a, nodes: nodes.filter((n) => n.area === a.id) })).filter((a) => a.nodes.length);
  state.bySize = [...state.areas].sort((a, b) => b.nodes.length - a.nodes.length);

  buildGraph();
  document.body.classList.add(`view-${state.layout}`);
  svg.call(zoom).on('dblclick.zoom', null);
  state.real = computeProven(nodes, baseMarks());
  state.shown = new Set(state.real);
  state.lit = litFor(state.shown);
  relayout();
  applyStatus();
  renderStatusLine();
  svg.node().append(viewport.node(), gAreas.node(), gLabels.node());
  wire();

  setTimeout(() => {
    if (!state.touched) setMode('today');
  }, 1100);
}

/* ---------- drawing ---------- */

function buildGraph() {
  for (const l of state.links) {
    // A field with many statements built directly on it would send a fan of lines into its block; the block's place above the field says the same.
    const bulk = l.type === 'within' && node(l.target).kind !== 'system' && state.built.get(l.source).length > 12;
    const g = gEdges.append('g').attr('class', `edge ${l.type}${l.follows ? ' follows' : ''}${l.inner ? ' inner' : ''}${l.bond ? ' bond' : ''}${l.stem ? ' stem' : ''}${bulk ? ' bulk' : ''} gone out`);
    [l.from, l.to] = [node(l.source), node(l.target)];
    l.dash = { related: 14, formerly: 10 }[l.type]; // the length of one dash and gap in styles.css
    // "Would follow from" is drawn as a shallow arc. Such a link often joins two entries of one row, where a
    // straight line would run through the entries between them and read as a chain (ERH, RH, GRH).
    l.line = l.follows ? g.append('path').attr('class', 'arc').node() : g.append('line').node();
    l.chev = g.append('path').attr('class', 'chev').attr('d', l.equivalent ? 'M-8,0 L-2,-4 L-2,4 Z M8,0 L2,-4 L2,4 Z' : 'M4.5,0 L-3,-4 L-3,4 Z').node();
    l.el = g.node();
  }

  for (const n of state.nodes) {
    const g = gNodes
      .append('g')
      .attr('class', `node kind-${n.kind}${n.hub ? ' hub' : ''} gone out`)
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', n.name);
    const inner = g.append('g').attr('class', 'inner');
    n.inner = inner.node();
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
    if (n.needs.length > 1) n.arc = inner.append('circle').attr('class', 'arc').attr('r', n.r + 4.5).attr('transform', 'rotate(-90)').node();
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
    const label = gLabels.append('g').attr('class', `label${n.big ? ' hub' : ''}${n.kind === 'system' ? ' sys' : ''} out`);
    const text = label.append('text');
    n.lines.forEach((line, i) => text.append('tspan').attr('x', 0).attr('dy', i === 0 ? '0.9em' : '1.15em').text(line));
    n.labelEl = label.node();
  }

  for (const n of state.nodes) if (n.kind === 'system') n.ballEl = gBalls.append('circle').attr('class', 'ball').attr('r', n.ball).node();

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
  const strip = document.querySelector('.hud-bottom');
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
    if (shape !== state.shape) [state.pos, state.levels] = [{}, {}];
    state.shape = shape;
    place(positions(state.layout));
    useLevels(state.layout);
  }
  for (const a of state.areas) {
    a.labelW = undefined; // the size of the area names depends on the window
    a.labelEl?.classList.remove('hidden'); // a hidden name cannot be measured
    a.labelHidden = false;
  }
  fit();
  requestAnimationFrame(prepareAreas); // after this picture is on screen
}

// The zoom from which each entry is drawn, as on a road map: zoomed out, only
// the entries most is built on; the others appear as the reader zooms in.
// Worked out from the farthest zoom inwards. At each step the entries not yet
// drawn are gone through, the most built-on first, and one is added if it
// keeps a label's distance on screen from everything drawn so far. Each step
// also goes only so far down the ranking, so that free space far out is not
// filled with minor entries that would later stand in the way of major ones.
// An entry that is drawn stays drawn at every closer zoom.
// `first` are entries drawn at every zoom, `skip` entries left to the caller (both for the molecule).
function zoomLevels(pos, first = [], skip = new Set()) {
  const [sx, sy] = labelRoom;
  const level = new Map(first.map((id) => [id, 0]));
  const drawn = first.map((id) => pos.get(id));
  // The farthest zoom is the one that shows the whole map: on a phone, with a few thousand entries, well below 0.1.
  const k0 = Math.min(0.1, fitScale(bounds([...pos.values()].map(([x, y]) => ({ x, y }))), freeArea(true)));
  for (let k = k0; k < 0.95; k *= 1.12) {
    const eligible = Math.max(40, state.order.length * (k / 0.45) ** 2); // at least the top 40; the whole ranking from a zoom of 0.45
    for (const n of state.order.slice(0, Math.ceil(eligible))) {
      if (level.has(n.id) || skip.has(n.id)) continue;
      const [x, y] = pos.get(n.id);
      if (drawn.some(([mx, my]) => Math.hypot(((x - mx) * k) / sx, ((y - my) * k) / sy) < 1)) continue;
      level.set(n.id, k > k0 ? k : 0);
      drawn.push([x, y]);
    }
  }
  return new Map(state.order.map((n) => [n.id, level.get(n.id) ?? 0.95]));
}

// In the molecule the subjects are drawn at every zoom: their bonds are the picture. The entries inside a ball
// appear as the reader zooms into it, the most built-on first, each as soon as its label has room among those
// already drawn in that ball. At the largest zoom all of them are drawn.
function moleculeLevels(pos) {
  const [sx, sy] = labelRoom;
  const level = zoomLevels(pos, [...state.inBall.keys()], new Set(state.nodes.filter((n) => n.ballOf).map((n) => n.id)));
  const rank = new Map(state.order.map((n, i) => [n.id, i]));
  for (const [subject, ids] of state.inBall) {
    const drawn = [pos.get(subject)];
    const left = new Set([...ids].sort((a, b) => rank.get(a) - rank.get(b)));
    for (let k = 0.95; k < maxZoom; k *= 1.12) {
      for (const id of left) {
        const [x, y] = pos.get(id);
        if (drawn.some(([mx, my]) => Math.hypot(((x - mx) * k) / sx, ((y - my) * k) / sy) < 1)) continue;
        level.set(id, k);
        drawn.push([x, y]);
        left.delete(id);
      }
    }
    for (const id of left) level.set(id, maxZoom);
  }
  return level;
}

const levelsFor = (view) => (state.levels[view] ??= view === 'molecule' ? moleculeLevels(positions(view)) : zoomLevels(positions(view)));

function useLevels(view) {
  levelsFor(view);
  for (const n of state.nodes) n.level = state.levels[view].get(n.id);
  if (updateShown()) positionLabels();
}

// Which entries are drawn right now: the ones the zoom is close enough for,
// and whatever the reader is looking at (the selected entry and its
// neighbours, a trace, a change that is spreading).
function updateShown() {
  const sel = state.selected;
  const near = sel ? neighbours(sel) : null;
  const { trace, wave } = state;
  let changed = false;
  let look = null; // worked out when the first entry appears
  for (const n of state.nodes) {
    const vis = state.t.k >= n.level || !!near?.has(n.id) || (!!trace && (trace.origin === n.id || trace.seen.has(n.id))) || !!wave?.ids.has(n.id);
    if (vis === n.vis) continue;
    n.vis = vis;
    // An entry that was not drawn does not have its colours up to date.
    if (vis) paintNode(n, (look ??= lookNow()));
    appear(n, vis);
    changed = true;
  }
  if (!changed) return false;
  for (const l of state.links) {
    const vis = l.from.vis && l.to.vis;
    if (vis === l.vis) continue;
    l.vis = vis;
    if (vis) paintLink(l, (look ??= lookNow()));
    appear(l, vis);
  }
  const shown = findBridges();
  $('zoom-note').textContent = shown.size < state.nodes.length ? `Showing ${shown.size} of ${state.nodes.length} entries. Zoom in for more.` : `Showing all ${state.nodes.length} entries.`;
  return true;
}

// The dotted lines past entries that are hidden at this zoom. Returns the ids of the entries that are drawn.
function findBridges() {
  const shown = new Set(state.nodes.filter((n) => n.vis).map((n) => n.id));
  let found = bridges(state.nodes, shown, (b, a) => node(b).roots.has(a));
  if (state.layout === 'molecule') {
    // In the molecule the only line an entry has is the one to its home. Where the home is hidden, the dotted
    // line leads on from home to home, to the first entry that is drawn.
    found = [];
    for (const n of state.nodes) {
      if (!n.vis || !n.home || n.ballOf || shown.has(n.home)) continue;
      let below = node(n.home);
      while (below.home && !below.vis) below = node(below.home);
      if (below.vis) found.push({ source: below.id, target: n.id, needsOnly: true });
    }
  }
  state.bridges = found.map((l) => ({ ...l, source: node(l.source), target: node(l.target) }));
  drawBridges();
  return shown;
}

// Written straight to the elements, without d3: this runs on every step of a
// zoom that changes what is drawn, and for thousands of lines when the
// arrangement changes.
function setLine(line, x1, y1, x2, y2) {
  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', x2);
  line.setAttribute('y2', y2);
}

// A dotted or dashed line is drawn only as far as it is inside the window.
// The browser works out every dot of such a line along its whole length, also
// outside the window: with 500 dotted lines across a map of 3,000 entries,
// Firefox took 350 ms for a frame. Returns false when no part is inside.
// The dots keep their place along the line (stroke-dashoffset), so they do not
// crawl while the map is panned. `period` is the length of one dash and gap.
function clipLine(line, a, b, period) {
  const { x, y, k } = state.t;
  const [x0, y0, x1, y1] = [(-40 - x) / k, (-40 - y) / k, (window.innerWidth + 40 - x) / k, (window.innerHeight + 40 - y) / k];
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  let [from, to] = [0, 1]; // the part inside, as fractions of the line (Liang–Barsky)
  for (const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]]) {
    if (p === 0 && q < 0) return false;
    if (p < 0) from = Math.max(from, q / p);
    if (p > 0) to = Math.min(to, q / p);
  }
  if (from >= to) return false;
  setLine(line, a.x + dx * from, a.y + dy * from, a.x + dx * to, a.y + dy * to);
  line.setAttribute('stroke-dashoffset', (from * Math.hypot(dx, dy) * k) % period);
  return true;
}

const bridgeLines = []; // the <line> elements in use, reused from one call to the next
// Fading an entry or a link in and out. What is not drawn is taken out of the
// page altogether (class `out`: display none), because Firefox slows down with
// every element the graph holds, drawn or not: with 3,000 entries a zoom took
// 180 ms a frame. Something that is out cannot fade in within the same frame,
// so it is put back first and loses `gone` one frame later. Fading out, it
// stays for the length of the fade (`until`); cull() takes it out afterwards.
const FADE = 320;
let appearing = [];
function appear(item, vis) {
  if (!vis) {
    item.until = performance.now() + FADE;
    item.el.classList.add('gone');
    return;
  }
  if (!item.live) {
    item.live = true;
    item.el.classList.remove('out');
  }
  if (!appearing.length) {
    requestAnimationFrame(() => {
      for (const it of appearing) if (it.vis) it.el.classList.remove('gone');
      appearing = [];
    });
  }
  appearing.push(item);
}

// Keeps in the page only what is drawn and in or near the window. Runs with
// every step of a zoom or a pan (from positionLabels, which works out `near`).
let cullTimer = 0;
function cull() {
  const now = performance.now();
  let fading = false;
  const set = (item, live) => {
    if (live === !!item.live) return;
    item.live = live;
    item.el.classList.toggle('out', !live);
  };
  for (const n of state.nodes) {
    const stays = n.vis || n.until > now;
    fading ||= !n.vis && n.until > now;
    set(n, stays && n.near);
    if (n.on !== n.labelLive) n.labelEl.classList.toggle('out', !(n.labelLive = n.on));
  }
  for (const l of state.links) {
    const stays = l.vis || l.until > now;
    fading ||= !l.vis && l.until > now;
    const [a, b] = [l.from, l.to];
    // A link stays unless both ends lie beyond the same side of the window.
    const inside = a.near || b.near || !((a.sx < 0 && b.sx < 0) || (a.sy < 0 && b.sy < 0) || (a.sx > window.innerWidth && b.sx > window.innerWidth) || (a.sy > window.innerHeight && b.sy > window.innerHeight));
    // "Related" and "first proven assuming" are drawn dotted and dashed: see clipLine.
    set(l, stays && inside && (!l.dash || clipLine(l.line, a, b, l.dash)));
  }
  placeBridges();
  clearTimeout(cullTimer);
  if (fading) cullTimer = setTimeout(cull, FADE + 30);
}

function drawBridges() {
  const g = gBridges.node();
  state.bridges.forEach((l, i) => {
    const line = (bridgeLines[i] ??= g.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'line')));
    const cls = `bridge${l.needsOnly ? '' : ' within'}${l.source.area === l.target.area ? ' inner' : ''}`;
    if (line.getAttribute('class') !== cls) line.setAttribute('class', cls);
  });
  for (const line of bridgeLines.splice(state.bridges.length)) line.remove();
  placeBridges();
}

// On every step of a zoom or a pan: the part of each bridge that is inside the window.
function placeBridges() {
  state.bridges.forEach((l, i) => {
    const line = bridgeLines[i];
    // A bridge between two entries that are both far outside the window is left out, even where it would cross it.
    const shown = (l.source.near || l.target.near) && clipLine(line, l.source, l.target, 6);
    if (shown !== line.shown) line.style.display = (line.shown = shown) ? '' : 'none';
  });
}

// Where every entry sits in one arrangement, worked out the first time that
// arrangement is shown in the current shape.
function positions(view) {
  const [areas, fold] = state.shape.split('/');
  state.pos[view] ??= view === 'tree' ? layoutTree(+fold) : view === 'molecule' ? layoutMolecule(areas) : areasFor(areas).finish();
  return state.pos[view];
}

// The Areas arrangement takes long to work out (half a second on a fast
// machine, two on a phone), so it is not left to the click on "Areas": it is
// advanced a few steps at a time whenever the page has nothing else to do.
// Asked for before it is finished, the remaining steps run at once.
// The Molecule arrangement is worked out the same way, before the click on it.
let areasJob = null; // the arrangement being worked out, for one shape of the window
let areasQueued = false;
const whenIdle = window.requestIdleCallback
  ? (fn) => window.requestIdleCallback(fn)
  : (fn) =>
      setTimeout(() => {
        const end = performance.now() + 6;
        fn({ timeRemaining: () => end - performance.now() });
      }, 16);

function areasFor(shape) {
  if (areasJob?.shape !== shape) areasJob = { shape, ...layoutAreas(shape) };
  return areasJob;
}

function prepareAreas() {
  if ((state.pos.areas && state.levels.molecule) || areasQueued) return;
  areasQueued = true;
  whenIdle((idle) => {
    areasQueued = false;
    // The Molecule arrangement first, in one go: it takes a fraction of the time the Areas take.
    if (!state.levels.molecule) {
      levelsFor('molecule');
      return prepareAreas();
    }
    if (state.pos.areas) return;
    const job = areasFor(state.shape.split('/')[0]);
    while (job.left() && idle.timeRemaining() > 1) job.step();
    if (job.left()) return prepareAreas();
    levelsFor('areas');
  });
}

function place(pos) {
  for (const n of state.nodes) [n.x, n.y] = pos.get(n.id);
  moved();
}

function moved() {
  for (const a of state.areas) a.box = bounds(a.nodes);
  updatePositions();
}

// Switch between the tree, the molecule and the areas. The entries glide to their new places.
function setLayout(view) {
  if (view === state.layout) return;
  finishWave();
  cancelAnimationFrame(state.tween);
  state.layout = view;
  for (const v of ['tree', 'molecule', 'areas']) {
    document.body.classList.toggle(`view-${v}`, v === view);
    $(`btn-${v}`).setAttribute('aria-pressed', String(v === view));
  }
  const to = positions(view);
  useLevels(view);
  findBridges(); // they differ between the arrangements, also where the same entries are drawn
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
// highest thing it stands on. Entries of a row that stand on the same entry
// form a block: a few of them sit side by side, many are stacked in several
// lines, so that the hundreds of statements of one field do not stretch the
// row. Blocks are placed near the average position of what their entries are
// linked to in the rows below and above; a few sweeps up and down settle the
// order. `fold` (1 to 3) says how narrow the window is. The blocks are made
// as tall as it takes for the whole tree to have about the window's proportions.
function layoutTree(fold) {
  const slot = 106; // room for a dot and its label, side by side
  const line = 58; // distance between the lines of a block
  const gap = 128; // between the top line of one row and the bottom line of the next
  const proportions = [0, 2.1, 1.2, 0.6][fold]; // width of the tree divided by its height
  const below = (n) => [...n.rests, ...n.within];
  const above = (n) => [...state.dependents.get(n.id), ...state.built.get(n.id)];
  const both = (n) => [...below(n), ...above(n)];

  const rows = [];
  const blockOf = new Map(); // row and the entry stood on -> block
  for (const n of state.nodes) {
    const key = `${n.layer}|${n.home}`; // the highest thing it stands on
    if (!blockOf.has(key)) {
      const block = { members: [], x: 0 };
      blockOf.set(key, block);
      (rows[n.layer] ??= []).push(block);
    }
    blockOf.get(key).members.push(n);
  }
  const x = new Map();
  const y = new Map();
  // `wideness`: how many times more entries a block has side by side than stacked.
  // The axioms (nothing below them) and small blocks stay in one line.
  const shape = (wideness) => {
    let [width, height] = [0, 0];
    for (const row of rows) {
      for (const b of row) {
        const count = b.members.length;
        b.cols = count <= 5 || !below(b.members[0]).length ? count : Math.min(count, Math.ceil(Math.sqrt(count * wideness)));
        b.lines = Math.ceil(count / b.cols);
        b.width = b.cols * slot;
      }
      width = Math.max(width, row.reduce((sum, b) => sum + b.width + slot / 2, 0));
      height += (Math.max(...row.map((b) => b.lines)) - 1) * line + gap;
    }
    return width / height;
  };
  let [narrow, wide] = [0.1, 12];
  for (let i = 0; i < 9; i++) {
    const wideness = Math.sqrt(narrow * wide);
    if (shape(wideness) > proportions) wide = wideness;
    else narrow = wideness;
  }
  shape(narrow);

  for (const row of rows) {
    for (const b of row) {
      const count = b.members.length;
      b.heavy = b.members.reduce((sum, n) => sum + n.above.size, 0);
      // What most is built on goes in the top line, nearest to what stands on it, and in the middle of its line.
      b.members.sort((p, q) => q.above.size - p.above.size || p.i - q.i);
      b.members.forEach((n, i) => {
        const inLine = Math.min(b.cols, count - Math.floor(i / b.cols) * b.cols); // the last line may be shorter
        const k = i % b.cols;
        n.cell = [(k % 2 ? -1 : 1) * Math.ceil(k / 2) * slot + (inLine % 2 ? 0 : slot / 2), b.lines - 1 - Math.floor(i / b.cols)];
      });
    }
    // Start with the blocks that carry most in the middle of their row, so the trunk grows straight up.
    let [left, right] = [0, 0];
    [...row].sort((p, q) => q.heavy - p.heavy).forEach((b, i) => {
      if (i === 0) [b.x, left, right] = [0, -b.width / 2, b.width / 2];
      else if (i % 2) [b.x, right] = [right + slot / 2 + b.width / 2, right + slot / 2 + b.width];
      else [b.x, left] = [left - slot / 2 - b.width / 2, left - slot / 2 - b.width];
      settle(b);
    });
  }
  function settle(b) {
    for (const n of b.members) x.set(n.id, b.x + n.cell[0]);
  }

  // Order the blocks of a row by where each wants to be, then move them apart
  // just enough that neighbours do not overlap (isotonic regression).
  const spread = (row, linked) => {
    const order = row
      .map((b) => ({ b, was: b.x, want: d3.mean(b.members.flatMap(linked), (id) => x.get(id)) ?? b.x }))
      .sort((p, q) => p.want - q.want || p.was - q.was);
    let at = 0; // where the block would sit if all were pushed together from the left
    const stack = [];
    order.forEach((o, i) => {
      if (i) at += (order[i - 1].b.width + o.b.width) / 2 + slot / 2;
      o.at = at;
      let s = { sum: o.want - at, n: 1 };
      while (stack.length && stack.at(-1).sum / stack.at(-1).n > s.sum / s.n) {
        const prev = stack.pop();
        s = { sum: prev.sum + s.sum, n: prev.n + s.n };
      }
      stack.push(s);
    });
    let i = 0;
    for (const s of stack) {
      for (let k = 0; k < s.n; k++, i++) {
        order[i].b.x = s.sum / s.n + order[i].at;
        settle(order[i].b);
      }
    }
  };
  for (let sweep = 0; sweep < 8; sweep++) {
    for (let i = 1; i < rows.length; i++) spread(rows[i], sweep ? both : below);
    for (let i = rows.length - 2; i >= 0; i--) spread(rows[i], both);
  }
  for (let i = 1; i < rows.length; i++) spread(rows[i], both);

  let floor = 0; // the bottom line of the current row
  for (const row of rows) {
    for (const b of row) for (const n of b.members) y.set(n.id, floor - n.cell[1] * line);
    floor -= (Math.max(...row.map((b) => b.lines)) - 1) * line + gap;
  }
  return new Map(state.nodes.map((n) => [n.id, [x.get(n.id), y.get(n.id)]]));
}

// Where the entries inside a subject's ball lie, relative to the subject: on rings around it, 21 apart, with 30
// along a ring from one entry to the next. At the largest zoom that is the room a label needs.
function ballPlaces(count) {
  const out = [];
  for (let ring = 1; out.length < count; ring++) {
    const r = 21 * (ring + 1);
    const n = Math.min(Math.floor((2 * Math.PI * r) / 30), count - out.length);
    for (let j = 0; j < n; j++) out.push([r * Math.cos((j * 2 * Math.PI) / n + ring), r * Math.sin((j * 2 * Math.PI) / n + ring)]);
  }
  return out;
}

const ballRadius = (count) => (count ? Math.hypot(...ballPlaces(count)[count - 1]) + 14 : 30);

// The molecule. Every subject (a number system or a theory) is an atom: a ball that holds the statements at it
// that nothing rests on, so its size says how many there are. The atoms are joined by bonds, each to the subject
// it is built in, and the bonds run in six directions only, 60 degrees apart, as in a structural formula. Set
// theory has its subjects on all six sides. In three steps.
// Around one subject: the statements at it that others rest on stand on rings around the ball, each with what
// rests on it fanned out behind it on the rings further out. Such a group takes the angle its widest row needs,
// and the groups share out the gaps between the subject's bonds. Small groups stand on the rings close to the
// ball; the few large ones start further out, where a ring is long enough for them.
// The subjects among themselves: worked out from the outermost inwards. A subject with all that is built in it
// is one rigid piece. It is turned into its direction and pushed out along it until it touches nothing that is
// placed already and no bond crosses another. Which piece gets which direction is tried in every order, and the
// most compact result is kept.
// Last, the whole is turned to suit the shape of the window.
function layoutMolecule(shape) {
  const TAU = 2 * Math.PI;
  const [between, along] = [90, 80]; // from one ring around a ball to the next, and the room along a ring for one statement
  const lane = 0.16; // the angle kept free on each side of a bond between two subjects
  const large = 8; // a statement with more than this many behind it, itself included, starts further out
  const clear = 15; // the least room between a subject's outermost ring and a bond that passes it
  const lengthCounts = 0.6; // the most compact arrangement is kept; a bond's length counts this much on top
  const isSubject = (id) => node(id).kind === 'system';
  const middle = state.middle;
  const behind = (id) => state.around.get(id).filter((k) => !isSubject(k));

  // How many statements a statement has behind it, itself included, and how many rings they take.
  const size = new Map();
  const rings = new Map();
  const count = (id) => {
    size.set(id, 1 + behind(id).reduce((sum, k) => sum + count(k), 0));
    rings.set(id, 1 + Math.max(0, ...behind(id).map((k) => rings.get(k))));
    return size.get(id);
  };

  // The statements in and around one subject, relative to it. `bonds` are the directions of its bonds to other subjects.
  // Returns the places and the radius the outermost ring reaches to.
  const around = (id, bonds) => {
    const ball = node(id).ball;
    const places = ballPlaces(state.inBall.get(id).length);
    const pts = state.inBall.get(id).map((k, i) => [k, ...places[i]]);
    const groups = behind(id).filter((k) => !node(k).ballOf);
    if (!groups.length) return { pts, reach: ball + 26 };
    groups.forEach(count);
    const isLarge = (k) => size.get(k) > large;
    const outermost = (list) => Math.max(0, ...list.map((k) => rings.get(k) - 1)) * between;
    const [small, big] = [groups.filter((k) => !isLarge(k)), groups.filter(isLarge)];
    const sorted = [...bonds].sort((a, b) => a - b);
    const gaps = sorted.length ? sorted.map((a, i) => ({ from: a + lane, width: (i + 1 < sorted.length ? sorted[i + 1] - a : sorted[0] + TAU - a) - 2 * lane })) : [{ from: 0, width: TAU }];
    // With the small groups starting at the radius `near` and the large ones at `far`: do all of `list` fit into the gaps?
    const fit = (list, near, far) => {
      const width = new Map();
      const need = (k, r) => {
        const w = Math.max(along / r, behind(k).reduce((sum, c) => sum + need(c, r + between), 0));
        width.set(k, w);
        return w;
      };
      const bins = gaps.map((g) => ({ ...g, in: [], used: 0 }));
      for (const [k, w] of list.map((k) => [k, need(k, isLarge(k) ? far : near)]).sort((p, q) => q[1] - p[1])) {
        const bin = bins.reduce((p, q) => (q.width - q.used > p.width - p.used ? q : p));
        if (bin.width - bin.used < w) return null;
        bin.in.push(k);
        bin.used += w;
      }
      return { bins, width };
    };
    let best = null;
    for (let near = ball + 62; !best || (small.length && near + outermost(small) < best.reach); near += 15) {
      if (!fit(small, near, near)) continue;
      for (let far = near; ; far += 15) {
        const reach = Math.max(small.length ? near + outermost(small) : 0, big.length ? far + outermost(big) : 0);
        if (best && reach >= best.reach) break;
        const got = fit(groups, near, far);
        if (got) {
          best = { reach, near, far, ...got };
          break;
        }
      }
      if (!small.length) break;
    }
    // A statement stands in the middle of its angle, what rests on it in the middle of that again, the widest in the centre.
    const centred = (list) => {
      const mid = [];
      list.forEach((k, i) => (i % 2 ? mid.push(k) : mid.unshift(k)));
      return mid;
    };
    const put = (k, r, from) => {
      const w = best.width.get(k);
      pts.push([k, r * Math.cos(from + w / 2), r * Math.sin(from + w / 2)]);
      const next = centred(behind(k).sort((p, q) => best.width.get(q) - best.width.get(p)));
      let at = from + (w - next.reduce((sum, c) => sum + best.width.get(c), 0)) / 2;
      for (const c of next) {
        put(c, r + between, at);
        at += best.width.get(c);
      }
    };
    for (const bin of best.bins) {
      const pad = (bin.width - bin.used) / (bin.in.length + 1); // the same room before, between and after the groups
      let at = bin.from + pad;
      for (const k of centred(bin.in)) {
        put(k, isLarge(k) ? best.far : best.near, at);
        at += best.width.get(k) + pad;
      }
    }
    return { pts, reach: best.reach + 40 };
  };

  // The subject each subject is built in: the one its home lies at.
  const subjectOf = (id) => (isSubject(id) ? id : node(id).home ? subjectOf(node(id).home) : middle.id);
  const built = new Map([...state.inBall.keys()].map((id) => [id, []]));
  for (const id of built.keys()) if (id !== middle.id) built.get(node(id).home ? subjectOf(node(id).home) : middle.id).push(id);

  // A piece: subjects with their place, the radius they reach to, how far each was turned, and the bonds between them
  // (`from` and `to`, as positions in these lists). The first subject lies at 0,0 and what it is built in lies to its
  // left. `box` is the rectangle the piece takes up. Plain lists of numbers: this is gone through a million times.
  const segDist = (px, py, ax, ay, bx, by) => {
    const vx = bx - ax;
    const vy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1)));
    return Math.hypot(px - ax - t * vx, py - ay - t * vy);
  };
  // On which side of the line a-b the point c lies; 0 on the line, so that bonds in one straight line do not count as crossing.
  const side = (ax, ay, bx, by, cx, cy) => {
    const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    return Math.abs(v) < 1 ? 0 : Math.sign(v);
  };
  const cross = (ax, ay, bx, by, cx, cy, dx, dy) => side(ax, ay, bx, by, cx, cy) * side(ax, ay, bx, by, dx, dy) < 0 && side(cx, cy, dx, dy, ax, ay) * side(cx, cy, dx, dy, bx, by) < 0;
  const boxOf = (c) => {
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < c.x.length; i++) {
      box[0] = Math.min(box[0], c.x[i] - c.reach[i]);
      box[1] = Math.min(box[1], c.y[i] - c.reach[i]);
      box[2] = Math.max(box[2], c.x[i] + c.reach[i]);
      box[3] = Math.max(box[3], c.y[i] + c.reach[i]);
    }
    return box;
  };
  const turned = (c, angle) => {
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    const out = { ...c, x: c.x.map((x, i) => x * cos - c.y[i] * sin), y: c.x.map((x, i) => x * sin + c.y[i] * cos), turn: c.turn.map((t) => t + angle) };
    out.box = boxOf(out);
    return out;
  };
  // Does the piece c, moved by dx,dy, touch the piece b, or does the bond from b's first subject to c's?
  // `way`: b's first subject still needs a free way to the left, to the subject it is built in.
  const touches = (b, c, dx, dy, way) => {
    const nb = b.x.length;
    const nc = c.x.length;
    const apart = c.box[0] + dx > b.box[2] + clear || c.box[2] + dx < b.box[0] - clear || c.box[1] + dy > b.box[3] + clear || c.box[3] + dy < b.box[1] - clear;
    for (let j = 0; j < nc; j++) {
      const x = c.x[j] + dx;
      const y = c.y[j] + dy;
      const r = c.reach[j];
      if (way && x < 0 && Math.abs(y) < r + clear) return true;
      if (apart) continue;
      for (let i = 0; i < nb; i++) if ((x - b.x[i]) ** 2 + (y - b.y[i]) ** 2 < (r + b.reach[i]) ** 2) return true;
      for (let i = 0; i < b.from.length; i++) if (segDist(x, y, b.x[b.from[i]], b.y[b.from[i]], b.x[b.to[i]], b.y[b.to[i]]) < r + clear) return true;
    }
    for (let j = 0; j < c.from.length; j++) {
      const ax = c.x[c.from[j]] + dx;
      const ay = c.y[c.from[j]] + dy;
      const bx = c.x[c.to[j]] + dx;
      const by = c.y[c.to[j]] + dy;
      if (way && ay * by < 0 && ax - (ay * (bx - ax)) / (by - ay) < 0) return true;
      if (apart) continue;
      for (let i = 0; i < nb; i++) if (segDist(b.x[i], b.y[i], ax, ay, bx, by) < b.reach[i] + clear) return true;
      for (let i = 0; i < b.from.length; i++) if (cross(ax, ay, bx, by, b.x[b.from[i]], b.y[b.from[i]], b.x[b.to[i]], b.y[b.to[i]])) return true;
    }
    for (let i = 1; i < nb; i++) if (segDist(b.x[i], b.y[i], 0, 0, dx, dy) < b.reach[i] + clear) return true;
    for (let i = 0; i < b.from.length; i++) if (b.from[i] && cross(0, 0, dx, dy, b.x[b.from[i]], b.y[b.from[i]], b.x[b.to[i]], b.y[b.to[i]])) return true;
    return false;
  };
  const orders = (list) => (list.length < 2 ? [list] : list.flatMap((x, i) => orders([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [x, ...rest])));
  const sides = [[], [0], [1, -1], [0, 2, -2], [1, -1, 2, -2], [0, 1, -1, 2, -2]]; // for one to five subjects built in one: their directions, in sixths of a turn from straight on
  const piece = (id, root) => {
    // The subjects built in this one, the one least stands on first: placed first, it comes to lie closest.
    const kids = built.get(id).sort((a, b) => node(a).above.size - node(b).above.size);
    const k = kids.length;
    // Six directions, and twice as many as often as needed where more subjects are built in one than six have room for.
    let turns = 6;
    while (turns < k + (root ? 0 : 1)) turns *= 2;
    const steps = root ? kids.map((_, i) => Math.floor((i * turns) / k)) : turns === 6 ? sides[k] : kids.map((_, i) => Math.round(((i + 1) * turns) / (k + 1)) - turns / 2);
    const dirs = steps.map((n) => (n * TAU) / turns);
    const made = around(id, [...(root ? [] : [Math.PI]), ...dirs]);
    const subs = kids.map((kid) => piece(kid, false));
    const ways = new Map(dirs.map((dir) => [dir, subs.map((sub) => turned(sub, dir))])); // every piece turned into every direction
    let best = null;
    for (let far = 1; !best; far *= 1.5) {
      // The whole may be turned freely, so the first subject built in set theory keeps its direction.
      for (const order of root ? orders(dirs.slice(1)).map((rest) => [dirs[0], ...rest]) : orders(dirs)) {
        const b = { id: [id], x: [0], y: [0], reach: [made.reach], turn: [0], made: [made], from: [], to: [], box: [-made.reach, -made.reach, made.reach, made.reach] };
        const bound = best ? best.cost : Infinity;
        let cost = 0;
        for (let i = 0; i < k && cost < bound; i++) {
          const c = ways.get(order[i])[i];
          const [ux, uy] = [Math.cos(order[i]), Math.sin(order[i])];
          let d = (made.reach + c.reach[0]) * far;
          // Pushed out step by step. Past a certain distance this order is given up; if every order fails, all
          // start further out. In the end a piece is put down as it is: a picture with an overlap is better than none.
          const end = far > 40 ? d : d + 14000 * far;
          while (d < end && cost + lengthCounts * d < bound && touches(b, c, d * ux, d * uy, !root)) d += 40;
          cost += d < end || far > 40 ? lengthCounts * d : Infinity;
          if (cost >= bound) break;
          const at = b.x.length;
          b.from.push(0, ...c.from.map((p) => p + at));
          b.to.push(at, ...c.to.map((q) => q + at));
          for (let j = 0; j < c.x.length; j++) {
            b.id.push(c.id[j]);
            b.x.push(c.x[j] + d * ux);
            b.y.push(c.y[j] + d * uy);
            b.reach.push(c.reach[j]);
            b.turn.push(c.turn[j]);
            b.made.push(c.made[j]);
          }
          b.box = [Math.min(b.box[0], c.box[0] + d * ux), Math.min(b.box[1], c.box[1] + d * uy), Math.max(b.box[2], c.box[2] + d * ux), Math.max(b.box[3], c.box[3] + d * uy)];
        }
        if (cost < bound) cost += Math.max(...b.x.map((x, i) => Math.hypot(x, b.y[i]) + b.reach[i]));
        if (cost < bound) best = { cost, b };
      }
    }
    return best.b;
  };
  const whole = piece(middle.id, true);

  // The whole is then turned, in steps of 30 degrees, to the angle at which it fills a window of this shape best.
  const want = { tall: 0.6, wide: 1.5, flat: 2.6 }[shape]; // width of the window divided by its height
  let best = null;
  for (let i = 0; i < 6; i++) {
    const at = turned(whole, (i * Math.PI) / 6);
    const span = (list) => Math.max(...list.map((v, j) => v + at.reach[j])) - Math.min(...list.map((v, j) => v - at.reach[j]));
    const fits = Math.min(want / span(at.x), 1 / span(at.y));
    if (!best || fits > best.fits) best = { fits, at };
  }

  const pos = new Map();
  best.at.id.forEach((id, j) => {
    const [cos, sin] = [Math.cos(best.at.turn[j]), Math.sin(best.at.turn[j])];
    pos.set(id, [best.at.x[j], best.at.y[j]]);
    for (const [k, x, y] of best.at.made[j].pts) pos.set(k, [best.at.x[j] + x * cos - y * sin, best.at.y[j] + x * sin + y * cos]);
  });
  return pos;
}

// The areas, in two passes. First the areas are packed as circles sized by
// how many statements they hold, pulled into a tall, wide or flat arrangement.
// Then every statement is pulled towards its area's centre and along its links.
// The second pass is returned unfinished: `step` advances it by one of its 700
// steps, `left` says how many remain, `finish` runs the rest and returns the positions.
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
  const fan = (d) => Math.sqrt(state.dependents.get(d.id).length + state.follows.get(d.id).length + (d.area === 'foundations' ? state.built.get(d.id).filter((id) => node(id).area === d.area).length : 0));

  const simulation = d3
    .forceSimulation(sim)
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
    .stop();

  let left = 700;
  let result = null;
  return {
    left: () => left,
    step: () => {
      simulation.tick();
      left--;
    },
    finish: () => {
      simulation.tick(left);
      left = 0;
      result ??= new Map(sim.map((p) => [p.id, [p.x, p.y]]));
      return result;
    },
  };
}

function bounds(nodes) {
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

function updatePositions() {
  for (const n of state.nodes) {
    n.el.setAttribute('transform', `translate(${n.x},${n.y})`);
    if (n.ballEl) n.ballEl.setAttribute('transform', `translate(${n.x},${n.y})`);
  }
  for (const l of state.links) {
    const s = node(l.source);
    const t = node(l.target);
    const angle = (Math.atan2(t.y - s.y, t.x - s.x) * 180) / Math.PI;
    if (l.follows) {
      // The arc bows to one side by up to 110, enough to pass the dots of a row; its arrowhead sits at the top of the bow.
      const [dx, dy] = [t.x - s.x, t.y - s.y];
      const length = Math.hypot(dx, dy) || 1;
      const bow = Math.min(0.3 * length, 110);
      const [mx, my] = [(s.x + t.x) / 2, (s.y + t.y) / 2];
      const [px, py] = [(-dy / length) * bow, (dx / length) * bow];
      l.line.setAttribute('d', `M${s.x},${s.y} Q${mx + px},${my + py} ${t.x},${t.y}`);
      l.chev.setAttribute('transform', `translate(${mx + px / 2},${my + py / 2}) rotate(${angle})`);
      continue;
    }
    if (!l.dash) setLine(l.line, s.x, s.y, t.x, t.y); // dotted and dashed lines are placed in cull()
    const f = l.equivalent ? 0.5 : 0.58;
    l.chev.setAttribute('transform', `translate(${s.x + (t.x - s.x) * f},${s.y + (t.y - s.y) * f}) rotate(${angle})`);
  }
  drawBridges();
}

function moveTo(target, animate, duration = 450) {
  if (animate && !reduceMotion) svg.transition().duration(duration).call(zoom.transform, target);
  else svg.call(zoom.transform, target);
}

// Show all of `nodes` (the whole graph by default) in the free part of the window.
function fit(animate = false, nodes = state.nodes) {
  fitBox(bounds(nodes), animate);
  // The reader can always zoom out as far as the whole map.
  zoom.scaleExtent([Math.min(0.12, fitScale(bounds(state.nodes), freeArea(true))), maxZoom]);
}

// The zoom at which a box fills the free part of the window.
function fitScale({ x0, x1, y0, y1 }, area) {
  const padX = Math.min(62, window.innerWidth * 0.08);
  const padTop = Math.min(40, (area.bottom - area.top) * 0.12);
  const padBottom = Math.min(44, (area.bottom - area.top) * 0.14);
  return Math.min((area.right - area.left - 2 * padX) / (x1 - x0 || 1), (area.bottom - area.top - padTop - padBottom) / (y1 - y0 || 1), 1.3);
}

function fitBox({ x0, x1, y0, y1 }, animate = false, duration) {
  const area = freeArea();
  const padTop = Math.min(40, (area.bottom - area.top) * 0.12);
  const padBottom = Math.min(44, (area.bottom - area.top) * 0.14);
  const k = fitScale({ x0, x1, y0, y1 }, area);
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
  // Dots shrink and grow with the zoom, but only by its square root. Written on each dot: a CSS variable
  // on the whole graph would make the browser work out the style of every element again at each step.
  // Only the dots inside the window are resized, in positionLabels: zoomed in, most entries are drawn but far outside it.
  if (e.transform.k !== state.t.k) state.dotScale = `scale(${Math.pow(e.transform.k, -0.5)})`;
  state.t = e.transform;
  viewport.attr('transform', e.transform);
  updateShown();
  positionLabels();
}

function sizeDot(n) {
  if (n.dotScale !== state.dotScale) n.inner.setAttribute('transform', (n.dotScale = state.dotScale));
}

const screenR = (n) => n.r * Math.sqrt(state.t.k);

// Labels keep a fixed size on screen. Where two would collide, the less
// important one is hidden until the reader zooms in, hovers or selects it.
// This runs on every step of a zoom or a pan, so it keeps its boxes as plain
// numbers (four per box: left, top, right, bottom) and writes to a label only
// what changed since the last time.
let boxes = null; // the labels placed so far in this call, then the dots
function positionLabels() {
  const sel = state.selected;
  const near = sel ? neighbours(sel) : new Set();
  const { trace, hover, t } = state;
  const byArea = state.layout === 'areas';
  const inMolecule = state.layout === 'molecule';
  boxes ??= new Float64Array(4 * (2 * state.nodes.length + state.areas.length));
  let placed = 0; // labels take boxes[0 .. placed)
  const hits = (from, to, x0, y0, x1, y1) => {
    for (let i = from; i < to; i += 4) if (x0 < boxes[i + 2] && x1 > boxes[i] && y0 < boxes[i + 3] && y1 > boxes[i + 1]) return true;
    return false;
  };
  const put = (at, x0, y0, x1, y1) => {
    boxes[at] = x0;
    boxes[at + 1] = y0;
    boxes[at + 2] = x1;
    boxes[at + 3] = y1;
  };
  const move = (item, dom, x, top) => {
    const to = `translate(${x},${top})`;
    if (to !== item.labelAt) dom.setAttribute('transform', (item.labelAt = to));
  };
  const hide = (n, hidden) => {
    if (hidden !== n.labelHidden) n.labelEl.classList.toggle('hidden', (n.labelHidden = hidden));
  };

  // Area names head the clouds of the Areas arrangement; in the tree and the molecule the areas are interleaved, so they are not shown.
  // Zoomed far out, the names of small areas would lie across their neighbours' names: the larger area keeps its name.
  for (const a of byArea ? state.bySize : []) {
    const [x, y] = t.apply([(a.box.x0 + a.box.x1) / 2, a.box.y0]);
    const top = y - 40;
    a.labelW ??= a.labelEl.getBBox().width; // differs by screen size, so measured (again after a resize)
    const hidden = hits(0, placed, x - a.labelW / 2 - 8, top - 4, x + a.labelW / 2 + 8, top + 22);
    if (hidden !== a.labelHidden) a.labelEl.classList.toggle('hidden', (a.labelHidden = hidden));
    if (hidden) continue;
    move(a, a.labelEl, x, top);
    put(placed, x - a.labelW / 2, top, x + a.labelW / 2, top + 18);
    placed += 4;
  }

  // Entries that are drawn but outside the window need neither a label nor room kept for their dot.
  const [right, bottom] = [window.innerWidth + 140, window.innerHeight + 60];
  const onScreen = [];
  for (const n of state.nodes) {
    n.sx = t.x + t.k * n.x;
    n.sy = t.y + t.k * n.y;
    n.on = n.vis && n.sx > -140 && n.sx < right && n.sy > -60 && n.sy < bottom;
    n.near = n.sx > -400 && n.sx < right + 260 && n.sy > -400 && n.sy < bottom + 340;
    if (!n.on) {
      hide(n, true);
      continue;
    }
    onScreen.push(n);
    sizeDot(n);
  }
  for (const n of onScreen) {
    n.rank =
      (n.id === hover ? 100000 : 0) +
      (n.id === sel ? 50000 : 0) +
      (trace?.origin === n.id ? 50000 : 0) +
      (n.hub ? 10000 : 0) +
      (n.kind === 'system' ? (byArea ? 3000 : 12000) + n.above.size : 0) +
      (near.has(n.id) ? 4000 : 0) +
      (trace?.seen.has(n.id) ? 20000 : 0) +
      (n.kind !== 'theorem' ? 100 : 0) +
      n.weight * 10;
  }
  onScreen.sort((a, b) => b.rank - a.rank || a.i - b.i);

  // The dots of the entries that are drawn sit behind the room kept for labels.
  const dots = 4 * (state.nodes.length + state.areas.length);
  let dotsEnd = dots;
  for (const n of onScreen) {
    n.sr = screenR(n);
    n.dot = dotsEnd;
    put(dotsEnd, n.sx - n.sr, n.sy - n.sr, n.sx + n.sr, n.sy + n.sr);
    dotsEnd += 4;
  }

  for (const n of onScreen) {
    const h = n.lines.length * (n.big ? 15 : 13) + 2;
    const x0 = n.sx - n.labelW / 2 - 2;
    const x1 = n.sx + n.labelW / 2 + 2;
    const forced = n.id === hover || n.id === sel || trace?.origin === n.id;
    // The most rested-on statements, the systems and whatever a trace has lit may sit on top of neighbouring dots; they only give way to other labels.
    const loud = n.big || trace?.seen.has(n.id);
    const clear = (top) => !hits(0, placed, x0, top, x1, top + h);
    const free = (top) => !hits(dots, n.dot, x0, top, x1, top + h) && !hits(n.dot + 4, dotsEnd, x0, top, x1, top + h) && clear(top);
    // In the molecule a subject's name goes below its ball, as long as the ball is small on screen; closer in, the ball
    // fills with entries and the name stays at the subject's own mark in the middle.
    const ball = inMolecule && n.ball && n.ball * t.k < 90 ? n.ball * t.k : 0;
    const below = n.sy + Math.max(n.sr, ball) + 4;
    const above = n.sy - Math.max(n.sr, ball) - 4 - h;
    let top = null;
    if (free(below)) top = below;
    else if (free(above)) top = above;
    else if (loud && clear(below)) top = below;
    else if (loud && clear(above)) top = above;
    else if (forced) top = below;
    move(n, n.labelEl, n.sx, top ?? below);
    hide(n, top === null);
    if (top !== null) {
      put(placed, x0, top, x1, top + h);
      placed += 4;
    }
  }
  cull();
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

// What decides how an entry and a link are drawn, apart from their own status:
// the selection, a trace, and which entries are dimmed.
function lookNow() {
  const sel = state.selected;
  const trace = state.trace;
  const near = sel && state.focus && !trace ? neighbours(sel) : null;
  return { sel, trace, near, dimNode: (id) => (trace ? id !== trace.origin && !trace.seen.has(id) : !!near && !near.has(id)) };
}

function paintNode(n, { sel, trace, dimNode }) {
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
    if (frac !== n.arcAt) {
      const c = 2 * Math.PI * (n.r + 4.5);
      n.arc.setAttribute('stroke-dasharray', `${frac * c} ${c}`);
      n.arc.style.display = frac > 0 ? '' : 'none';
      n.arcAt = frac;
    }
  }
}

function paintLink(l, { sel, trace, near }) {
  const cl = l.el.classList;
  const on = l.type === 'needs' && state.lit.has(l.key);
  const traced = !!trace && trace.edges.has(l.key);
  cl.toggle('on', on);
  cl.toggle('waiting', l.type === 'needs' && !on && !state.shown.has(l.target));
  cl.toggle('whatif', on && !state.real.has(l.source));
  cl.toggle('traced', traced);
  cl.toggle('own', l.source === sel || l.target === sel);
  cl.toggle('dim', trace ? !traced : !!near && l.source !== sel && l.target !== sel);
}

// Brings the picture in line with the state. Only what is drawn is touched:
// with thousands of entries most are not, and updateShown paints an entry when it appears.
function applyStatus() {
  if (updateShown()) positionLabels();
  const look = lookNow();
  gBridges.classed('dim', !!look.trace || !!look.near);
  for (const n of state.nodes) if (n.vis) paintNode(n, look);
  for (const l of state.links) if (l.vis) paintLink(l, look);
  renderTally();
}

let tallyShown = '';
function renderTally() {
  const count = { proven: 0, whatif: 0, conditional: 0, open: 0 };
  for (const n of state.nodes.filter(isStatement)) count[isHypothetical(n.id) ? 'whatif' : statusOf(n)]++;
  const key = Object.values(count).join();
  if (key === tallyShown) return; // called on every step of a wave, mostly with nothing new
  tallyShown = key;
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
    const line = g.append('line').attr('x1', from.x).attr('y1', from.y).node();
    const dot = g.append('circle').attr('r', 3.5 / state.t.k).node();
    return { link, from, to, start, end, g: g.node(), line, dot, shown: false, done: false };
  });

  const reachR = maxDist + 110;
  const rings = seeds.flatMap((s) =>
    [0, 280, 560].map((delay, i) => ({
      delay,
      alpha: 0.75 - i * 0.2,
      shown: false,
      el: gWaves.append('circle').attr('class', `wave ${cls}`).attr('cx', s.x).attr('cy', s.y).attr('stroke-width', 2.5 - i * 0.7).style('display', 'none').node(),
    })),
  );

  const events = [...at].map(([id, time]) => ({ id, time })).sort((a, b) => a.time - b.time);
  const end = Math.max(...events.map((e) => e.time), ...drawn.map((f) => f.end), 560 + reachR / speed) + 150;
  // Everything the wave touches is drawn while it runs, whatever the zoom.
  const wave = { flows: drawn, rings, raf: 0, onDone, ids: new Set([...seedIds, ...order.map(([id]) => id)]) };
  state.wave = wave;
  if (updateShown()) positionLabels();
  let next = 0;
  const t0 = performance.now();

  const frame = (now) => {
    const t = now - t0;
    let dirty = false;

    for (const w of rings) {
      const r = (t - w.delay) * speed;
      const visible = r > 0 && r < reachR;
      if (visible !== w.shown) w.el.style.display = (w.shown = visible) ? '' : 'none';
      if (visible) {
        w.el.setAttribute('r', r);
        w.el.setAttribute('opacity', w.alpha * (1 - r / reachR));
      }
    }

    for (const f of drawn) {
      if (f.done || t < f.start) continue;
      const p = Math.min(1, (t - f.start) / (f.end - f.start));
      const x = f.from.x + (f.to.x - f.from.x) * p;
      const y = f.from.y + (f.to.y - f.from.y) * p;
      if (!f.shown) f.g.style.display = (f.shown = true) && '';
      f.line.setAttribute('x2', x);
      f.line.setAttribute('y2', y);
      f.dot.setAttribute('cx', x);
      f.dot.setAttribute('cy', y);
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
  const cl = dom.classList;
  const again = cl.contains('flip') || cl.contains('denied') || cl.contains('ping');
  cl.remove('flip', 'denied', 'ping');
  if (again) dom.getBoundingClientRect(); // restart the CSS animation (this makes the browser lay the page out, so only when needed)
  cl.add(cls);
  setTimeout(() => cl.remove(cls), 1000);
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
// the wave only lights up the part of the network that is connected. What an
// open statement would follow from is not part of either. Two more
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
  const links = state.links.filter((l) => ((l.type === 'needs' && !l.follows) || (all && l.type === 'within')) && inside(l.source) && inside(l.target));
  const below = (x) => (all ? [...node(x).rests, ...node(x).within] : node(x).rests);
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
  if (n.base === 'conditional') return `Proven only on condition. Still needs: ${listNames(waitsOn(state.nodes, state.shown, n.id))}.`;
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
  // What an open statement lists is what it would follow from. Once it holds, either that is how
  // it came to hold, or it holds on its own (today's proof, an assumed axiom, a what-if) and the list is only another way to it.
  const holds = state.shown.has(n.id);
  const onItsOwn = state.whatIf.has(n.id) || baseMarks().has(n.id);
  const listed = n.base !== 'open' ? 'Rests on' : !holds ? 'Would follow from' : onItsOwn ? 'Would also follow from' : 'Follows from';
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
    // `needs` of an open statement are one way to it (all of them together), `anyOf` holds further ways (each alone).
    ...section(n.base === 'open' && n.needs.length > 1 ? `${listed} these together` : listed, n.needs, linkSource),
    ...section(n.needs.length ? (n.anyOf.length > 1 ? 'Or from any one of' : 'Or from') : 'Would follow from any one of', n.anyOf, linkSource),
    ...section('Built within', n.within, linkSource),
    ...section('First proven assuming', n.formerly),
    ...section('Related', n.related),
    ...section('What rests on it directly', state.dependents.get(n.id)),
    ...section('What would follow from it', state.follows.get(n.id)),
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
  for (const n of state.nodes.filter((n) => n.vis)) {
    const [x, y] = state.t.apply([n.x, n.y]);
    const d = Math.hypot(x - clientX, y - clientY);
    if (d < Math.max(22, screenR(n) + 8) && d < bestD) [best, bestD] = [n, d];
  }
  return best;
}

// In the molecule, a click on a subject's ball zooms into it, until the ball is somewhat larger than the free part
// of the window: from there the names of the statements inside it can be read. Not if it is about that large
// already. Says whether it zoomed.
function openBall(clientX, clientY) {
  if (state.layout !== 'molecule') return false;
  const [x, y] = state.t.invert([clientX, clientY]);
  const n = state.nodes.find((s) => s.ball && Math.hypot(s.x - x, s.y - y) < s.ball);
  const area = freeArea();
  const room = Math.sqrt((area.right - area.left) * (area.bottom - area.top)); // a phone held sideways leaves a strip: neither its width nor its height alone says how much room there is
  if (!n || 2 * n.ball * state.t.k > room) return false;
  const k = Math.min(maxZoom, (1.3 * room) / (2 * n.ball));
  moveTo(d3.zoomIdentity.translate((area.left + area.right) / 2 - k * n.x, (area.top + area.bottom) / 2 - k * n.y).scale(k), true, 650);
  return true;
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
    else if (!openBall(e.clientX, e.clientY) && state.view === 'node') select(null);
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
  for (const view of ['tree', 'molecule', 'areas']) $(`btn-${view}`).addEventListener('click', touch(() => setLayout(view)));
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
