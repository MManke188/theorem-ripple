# Theorem Ripple

A map of mathematical statements and what they rest on. Live at https://mmanke188.github.io/theorem-ripple/. `README.md` explains what the page does and the data format; this file is how to work on it.

## Layout

- `data/index.json` lists the areas, today's event and the axioms assumed by default. One file per area holds the statements.
- `js/propagate.js` is the dependency logic with no DOM (what is proven, what rests on what, ripple order). It is the part with tests.
- `js/app.js` draws the graph, runs the waves and the panel. `styles.css`, `index.html`. No build step; `js/vendor/d3.min.js` is the only dependency.

## Adding or changing statements

Entries written from memory were wrong in detail about four times out of ten, so:

1. Every entry and every link is written from a source that was opened. Brief for a research agent: `tools/research-brief.md`.
2. A second, fresh agent then tries to find errors, and reports without editing. Brief: `tools/check-brief.md`.
3. Apply the corrections. Drop what stays unconfirmed. Leave a field out before guessing it.

An unreviewed recent claim of a proof or disproof goes in the `claim` field. It does not change `base`: the statement stays open until the mathematics has been reviewed. Check the current status of a conjecture by web search before calling it open; several were claimed settled in 2026.

`year` and `settled` are not used by the page yet. They exist for the planned timeline playback (press play, the network grows over time). Keep them filled in on new entries.

## Before pushing

Pushing to `main` publishes (GitHub Pages serves the repository root).

1. `node --test`
2. Serve locally (`python3 -m http.server 8377`) and run `node tools/shots.cjs` at the three sizes named in its header. `errors` must be empty, and the screenshots have to be looked at: label collisions and covered controls do not show up in the summary.
3. After the push, wait for the Pages build of that commit and run `tools/shots.cjs` once with `SHOT_URL` set to the live address.

## Known limits

- Few links between proven theorems: sources rarely state "this proof uses that theorem", and only stated links are kept. Unproven hubs therefore dominate the rankings.
- On a phone the overview hides most labels; area names zoom in.
- Three statements have no `year` because no source gave one.
