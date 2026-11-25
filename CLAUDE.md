# Theorem Ripple

A map of mathematical statements and what they rest on. Live at https://mmanke188.github.io/theorem-ripple/. `README.md` explains what the page does and the data format; this file is how to work on it.

## Layout

- `data/index.json` lists the areas, today's event and the axioms assumed by default. One file per area holds the statements. `data/foundations.json` is the trunk: the Zermelo–Fraenkel axioms, the number systems and theories (`kind: "system"`), and a few classical theorems.
- `js/propagate.js` is the dependency logic with no DOM (what is proven, what rests on what, ripple order, height above the axioms). It is the part with tests.
- `js/app.js` draws the graph in two arrangements (`layoutTree`: axioms at the bottom, one row per step above them, and within a row the entries that stand on the same entry stacked as a block; `layoutAreas`: one cluster per field), decides which entries are drawn at the current zoom (`zoomLevels`, `updateShown`), runs the waves and the panel. `styles.css`, `index.html`. No build step; `js/vendor/d3.min.js` is the only dependency. It holds only the parts of d3 listed in `tools/d3-entry.js` (how to rebuild it is written there); a d3 function outside that list does not exist on the page.

## Adding or changing statements

Entries written from memory were wrong in detail about four times out of ten, so:

1. Every entry and every link is written from a source that was opened. Brief for a research agent: `tools/research-brief.md`.
2. A second, fresh agent then tries to find errors, and reports without editing. Brief: `tools/check-brief.md`.
3. Apply the corrections. Drop what stays unconfirmed. Leave a field out before guessing it.

A statement with nothing in `needs`, or only axioms, gets `within`: the system it belongs to, taken from what its source says. So does every open statement: what an open entry lists in `needs` or `anyOf` is what it would follow from (`followsFrom` in `js/propagate.js`, drawn as a dashed arc), not what it rests on, and it places nothing in the tree. `within` only places an entry in the tree. Proven and conditional status never travel along it, so it must not be used to say that a proof uses something. The test "everything stands on the axioms of set theory" fails for an entry that cannot be followed down to ZF.

An unreviewed recent claim of a proof or disproof goes in the `claim` field. It does not change `base`: the statement stays open until the mathematics has been reviewed. Check the current status of a conjecture by web search before calling it open; several were claimed settled in 2026.

`year` and `settled` are not used by the page yet. They exist for the planned timeline playback (press play, the network grows over time). Keep them filled in on new entries.

## Adding statements in bulk

`tools/import/` builds draft entries from Wikipedia without browsing agents, at about 6,000 tokens an entry where the steps above cost about 230,000. The header of each script says what it does; they run in this order and each skips what is already done:

1. `list.cjs`: Wikidata's list of theorems, conjectures, lemmas, problems and axioms with an English article.
2. `fetch.cjs`: the articles' source text, 50 per request.
3. `write.cjs`: a cheap model (Sonnet) drafts an entry from the opening, the formal statement and the History section, with the sentences it relied on. The script checks that those sentences are in the article.
4. `review.cjs`: a stronger model (Opus) reads the whole article and corrects the draft. In the pilot (100 articles, graded by three browsing checkers) 4 of 65 drafts were false before this step, each for a condition given further down the article; the review fixed all four.
5. `links.cjs`: a model reads each sentence that links two statements and says whether it states that one rests on the other. In the pilot only 29 of 47 such links were fully right.
6. `linkcheck.cjs`: a stronger model sees the paragraph around each such sentence and keeps, drops or turns round the link. It kept about a third (in the pilot 35 of 47, of which 28 fully right and 6 "one proof among several").
7. `place.cjs`: finds a field for entries the review could not place, after new fields were written into `.import/new-systems.json` (those are written and checked the careful way, as above).
8. `merge.cjs`: writes entries and links into `data/`. Each imported entry carries `origin: "wikipedia-import"`; running it again replaces the earlier import. It prints what it left out and why, and saves that list in `.import/left-out.json`.

Working files are in `.import/` (not in git). `merge.cjs` keeps off the map: entries the reviewer doubted (`doubt`, about 1 in 13: it believes the article itself is wrong or incomplete, so they need a browsing check), open statements without a web search for their status (`.import/status.json`) or with a claimed proof nobody has checked against its source, statements found proven since (they need an entry written by hand), entries without a field, and links that would put a proven result on an unproven one. Entries listed in `.import/exclude.json` (found wrong by a check) stay off too. After a merge, a browsing agent grades a random sample (40 entries, 20 links) and what it finds wrong goes into that list.

The first run (November 2026) took 2,999 Wikidata candidates to 1,854 entries and 614 links for about 17 million tokens. Wikidata's list ends there: more entries need another list (Wikipedia's categories and lists of theorems, or a textbook index).

## Before pushing

Pushing to `main` publishes (GitHub Pages serves the repository root).

1. `node --test`
2. Serve locally (`python3 -m http.server 8377`) and run `node tools/shots.cjs` at the three sizes named in its header. `errors` must be empty, and the screenshots have to be looked at: label collisions and covered controls do not show up in the summary.
3. After a change to how the graph is drawn or animated, also run `node tools/perf.cjs phone`, `node tools/perf.cjs big` and `node tools/perf-firefox.cjs` before and after it and compare (the header of each file explains the numbers). All three are needed: the phone run does not show what drawing costs on a 4K screen, and Chromium does not show Firefox, the default browser on the machine this is built on. Four things made the page slow before: anything that makes the browser restyle or measure the whole graph on every frame (a CSS variable on the `<svg>`, `getBBox()`, `getBoundingClientRect()` inside a loop); long work inside a click; fades done with a transition on `opacity` or on a partly see-through group (the comment at the top of the graph's rules in `styles.css` says how fades are done now); and dotted or dashed lines drawn at full length (Firefox works out every dot, also outside the window: 500 such lines cost 350 ms a frame, see `clipLine`). The page is built to hold a few thousand entries: only what is drawn and near the window is in the page (`cull`), and a wave or a zoom touches only those. To test at that size, fill a copy of the site with made-up entries and run the same scripts against it.
4. After the push, wait for the Pages build of that commit and run `tools/shots.cjs` once with `SHOT_URL` set to the live address.

## Known limits

- Few links between proven theorems: sources rarely state "this proof uses that theorem", and only stated links are kept. Unproven hubs therefore dominate the rankings.
- The tree's `within` links are coarse: they say which theory a statement belongs to, as its source words it, not what its proof uses. A statement's height in the tree is therefore a fact about this map's chain of systems, not a measure of difficulty.
- Zoomed out, only the most built-on entries are drawn (`zoomLevels` in `js/app.js` ranks by how many entries stand on each one, so a famous result that nothing here rests on, such as Fermat's Last Theorem, appears late). On a phone the overview therefore holds about seven entries. Zoomed out, an area name that would lie across a larger area's name is hidden. Area names zoom in (Areas arrangement only; the tree has no area names).
- Three statements have no `year` because no source gave one.
