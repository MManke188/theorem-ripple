# Theorem Ripple

A map of mathematical statements and what they rest on. A link from A to B means **B rests on A**: either B was proven assuming the open conjecture A, or the cited proof of B uses the proven theorem A. A dashed, bowed arrow from A to B is a weaker link: the open statement B **would follow from** the stronger statement A and does not rest on it (the Riemann Hypothesis would follow from the Generalized Riemann Hypothesis). When B is proven some other way, A stays open.

The map is drawn like a molecule. Everything stands on the axioms of set theory. On them the number systems and theories are built (natural numbers, real numbers, group theory, complex analysis and so on, drawn as rounded squares), and in those the statements. Every number system or theory (a subject) is an atom, joined by a straight bond to the subject it is built in. The bonds run in six directions only, 60 degrees apart, and set theory, with the axioms inside it, has its subjects on all six sides. A subject's atom is a ball: the statements of that subject that nothing else rests on lie inside it, so the size of the ball says how many there are, and they appear as you zoom in (a click on the ball zooms into it). The statements that others rest on stand around the ball, each with what rests on it fanned out behind it. Every entry has one line, to the highest thing it stands on; its other lines are drawn when it is selected or traced. An open statement stands on its theory, not on the stronger statements it would follow from. A pale line from a statement to a system means "built within that system"; it is a coarser link than an arrow and no change ever travels along it.

The map works like a road map: zoomed out it draws in full only the subjects and the entries most is built on. Every other entry is a small dot in the colour of its status, and gets its mark and its name as you zoom in. A dotted line then stands for a chain of entries that are not drawn in full at this zoom. Whatever you are looking at is always drawn in full: the selected entry and its neighbours, a trace, and everything a change spreads to while it spreads. The line next to the counts says how many entries are drawn in full.

What you can do on the page:

- Switch from "Before 20 Nov 2026" to "Today" and watch the proof of the Riemann Hypothesis spread: every result that relied on it turns green, then the results that relied on those. Results that need a second, still open hypothesis stay amber.
- Select a statement and press "statements rest on this" or "This rests on" to light up everything downstream or upstream of it. What an open statement would follow from is not part of either; the panel lists it under "Would follow from".
- Select any entry and press "Down to the axioms" to light up everything it stands on, through its theory and the number systems down to the axioms. On a system or an axiom, "entries are built on this" shows the opposite direction.
- Select an open conjecture and press "What if this is proven?". What-if results are drawn in blue so they cannot be mistaken for proven ones. The change also travels along the dashed arrows: with GRH marked as proven, the Riemann Hypothesis holds too.
- Select an axiom that is assumed by default (the axiom of choice) and stop assuming it. Everything that needs it turns amber.
- Select any entry and press "Show only this and what it is connected to". Everything else disappears: the entry stands in the middle, what it stands on (down to the axioms) on one side and what stands on it on the other, one row per step away from it. In a wide window the rows run from left to right, in a tall one from bottom to top. Choosing another entry there puts that one in the middle. Escape or "Back to the map" returns to the map as it was. A subject with more than 120 entries on it is drawn with the subjects built on it and its own statements that others rest on; each subject shows how many entries are built on it.
- Press "Play history". The map empties and grows year by year: each entry appears in the year it was first stated or proven, and a statement that began as a conjecture is open until the year it was proven. Entries without a known year take no part; they are added together at the end. The slider moves through time.
- Open "Rankings" for the proven statements most rests on, the unproven ones most rests on, and the results furthest from the foundations.

A link to a proven theorem means "the cited proof uses it". Many theorems have several proofs, so such a link is a fact about one proof, with its source, and not a claim that no other route exists.

## Run it

Plain HTML, CSS and JavaScript, no build step. It needs a web server because it loads the files in `data/`:

```
python3 -m http.server 8377
```

Then open http://127.0.0.1:8377/.

## Tests

```
node --test
```

They cover the dependency logic in `js/propagate.js` and check every data file: ids unique across files, links point at existing entries, no cycles, no isolated entries, no open statement that the page would show as proven by accident, nothing that holds while resting on something that does not, and no entry that cannot be followed down to the axioms of set theory.

## Data

`data/index.json` lists the areas and their files, the `today` event (what counts as proven in the "Today" view, what is claimed but not confirmed) and `assumed`, the axioms accepted by default. Each area has one file, for example `data/number-theory.json`. `data/foundations.json` holds what everything else stands on: the Zermelo–Fraenkel axioms, the number systems and theories, and a few classical theorems.

```json
{ "area": "number-theory", "nodes": [ ... ] }
```

One entry per statement:

| Field | Meaning |
| --- | --- |
| `id`, `name`, `short` | Identifier (unique across all files), full name, label on the map |
| `statement` | The claim in one or two sentences |
| `kind` | `theorem`, `hypothesis`, `axiom`, `data`, or `system` (a number system or a theory: not a statement, so it has no `base` and no `needs`) |
| `base` | `proven`, `conditional` (proven assuming something in `needs` that is not proven) or `open` |
| `needs` | What the entry rests on or, for an open entry, what it would follow from. Each item is an id, or `{ "id": "...", "url": "..." }` when the link has its own source |
| `within` | The systems the entry is built in, written like `needs`. Says "this belongs to that theory" or "this system is constructed from that one". It places the entry on the map and carries no ripple. Every system has it, every open statement, and every other statement whose `needs` are empty or only axioms |
| `equivalent` | `true` if the entry is equivalent to the one statement in `needs`, not only a consequence |
| `related`, `formerly` | Links that carry no ripple: a connected statement (drawn dash-dot, and only while one of the two is selected), or a hypothesis the result no longer needs (dashed) |
| `by`, `note`, `url` | Attribution, comment, source |
| `anyOf` | Only on an open entry: statements any one of which alone would prove it. `needs` is one route (all of it together), each item here is a further route |
| `claim` | An unreviewed recent claim of a proof or disproof. Shown in the panel and as a pink dot; it does not change the status |
| `year`, `settled` | When the statement was first stated or proven, and, if it began as a conjecture, when it was proven. The playback reads them: an entry appears in `year` and is open until `settled`. Left out where no source gives a date (such an entry joins the playback only at its end). Years before the common era are negative |
| `formerlyYear` | When the result was first proven under the hypothesis in `formerly`. In the playback it appears then, as conditional, until `year` |
| `area` | The area id of the file it is in |

What `needs` means depends on `base`:

- `proven`: the proven theorems its cited proof uses. Empty for a foundation.
- `conditional`: at least one unproven statement or axiom, plus any proven theorems the proof uses.
- `open`: "if everything in this list were proven, this would be too". Two stronger statements that would each prove it alone go in `anyOf`, not here. Never list only proven theorems here, or the page shows the conjecture as proven. The tests catch that. An open entry rests on nothing: the page draws these links as dashed arcs and leaves them out of the traces and the "rests on" counts. So an open entry needs a `within` of its own.

To add an area, add its file and list it in `data/index.json`.

## Deploy

GitHub Pages serves the `main` branch from the repository root. Pushing to `main` publishes.
