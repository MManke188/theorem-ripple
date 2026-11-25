# Theorem Ripple

A map of mathematical statements and what they rest on. A link from A to B means **B rests on A**: either B was proven assuming the open conjecture A, or the cited proof of B uses the proven theorem A.

The map opens as a tree. The axioms of set theory are in the bottom row. Above them come the number systems and theories built on them (natural numbers, real numbers, group theory, complex analysis and so on, drawn as rounded squares), and above those the statements. Every entry sits one row above the highest thing it stands on. Entries of a row that stand on the same entry form a block above it, several lines high where they are many. A pale line from a statement to a system means "built within that system"; it is a coarser link than an arrow and no change ever travels along it. "Areas" in the header switches to the other arrangement, one cluster per field.

The map works like a road map: zoomed out it draws only the entries most is built on, and the others appear as you zoom in. A dotted line then stands for a chain of entries that are not drawn at this zoom. Whatever you are looking at is always drawn: the selected entry and its neighbours, a trace, and everything a change spreads to while it spreads. The line next to the counts says how many entries are drawn.

What you can do on the page:

- Switch from "Before 20 Nov 2026" to "Today" and watch the proof of the Riemann Hypothesis spread: every result that relied on it turns green, then the results that relied on those. Results that need a second, still open hypothesis stay amber.
- Select a statement and press "statements rest on this" or "This rests on" to light up everything downstream or upstream of it.
- Select any entry and press "Down to the axioms" to light up everything it stands on, through its theory and the number systems down to the axioms. On a system or an axiom, "entries are built on this" shows the opposite direction.
- Select an open conjecture and press "What if this is proven?". What-if results are drawn in blue so they cannot be mistaken for proven ones.
- Select an axiom that is assumed by default (the axiom of choice) and stop assuming it. Everything that needs it turns amber.
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

They cover the dependency logic in `js/propagate.js` and check every data file: ids unique across files, links point at existing entries, no cycles, no isolated entries, no open statement that the page would show as proven by accident, and no entry that cannot be followed down to the axioms of set theory.

## Data

`data/index.json` lists the areas and their files, the `today` event (what counts as proven in the "Today" view, what is claimed but not confirmed) and `assumed`, the axioms accepted by default. Each area has one file, for example `data/number-theory.json`. `data/foundations.json` is the trunk of the tree: the Zermelo–Fraenkel axioms, the number systems and theories, and a few classical theorems.

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
| `needs` | What the entry rests on. Each item is an id, or `{ "id": "...", "url": "..." }` when the link has its own source |
| `within` | The systems the entry is built in, written like `needs`. Says "this belongs to that theory" or "this system is constructed from that one". It places the entry in the tree and carries no ripple. Every system has it, and every statement whose `needs` are empty or only axioms |
| `equivalent` | `true` if the entry is equivalent to the one statement in `needs`, not only a consequence |
| `related`, `formerly` | Links that carry no ripple: a connected statement (drawn dash-dot), or a hypothesis the result no longer needs (dashed) |
| `by`, `note`, `url` | Attribution, comment, source |
| `anyOf` | Statements any one of which would prove this one (several independent routes) |
| `claim` | An unreviewed recent claim of a proof or disproof. Shown in the panel and as a pink dot; it does not change the status |
| `year`, `settled` | When the statement was first stated or proven, and, if it began as a conjecture, when it was proven. Not used by the page yet; recorded for a future timeline. Left out where no source gives a date. Years before the common era are negative |
| `formerlyYear` | When the result was first proven under the hypothesis in `formerly` |
| `area` | The area id of the file it is in |

What `needs` means depends on `base`:

- `proven`: the proven theorems its cited proof uses. Empty for a foundation.
- `conditional`: at least one unproven statement or axiom, plus any proven theorems the proof uses.
- `open`: "if everything in this list were proven, this would be too". Never list only proven theorems here, or the page shows the conjecture as proven. The tests catch that.

To add an area, add its file and list it in `data/index.json`.

## Deploy

GitHub Pages serves the `main` branch from the repository root. Pushing to `main` publishes.
