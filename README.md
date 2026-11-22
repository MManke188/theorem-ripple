# Theorem Ripple

A map of mathematical statements and what they rest on. A link from A to B means **B rests on A**: either B was proven assuming the open conjecture A, or the cited proof of B uses the proven theorem A.

What you can do on the page:

- Switch from "Before 20 Nov 2026" to "Today" and watch the proof of the Riemann Hypothesis spread: every result that relied on it turns green, then the results that relied on those. Results that need a second, still open hypothesis stay amber.
- Select a statement and press "statements rest on this" or "This rests on" to light up everything downstream or upstream of it.
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

They cover the dependency logic in `js/propagate.js` and check every data file: ids unique across files, links point at existing entries, no cycles, no isolated entries, and no open statement that the page would show as proven by accident.

## Data

`data/index.json` lists the areas and their files, the `today` event (what counts as proven in the "Today" view, what is claimed but not confirmed) and `assumed`, the axioms accepted by default. Each area has one file, for example `data/number-theory.json`:

```json
{ "area": "number-theory", "nodes": [ ... ] }
```

One entry per statement:

| Field | Meaning |
| --- | --- |
| `id`, `name`, `short` | Identifier (unique across all files), full name, label on the map |
| `statement` | The claim in one or two sentences |
| `kind` | `theorem`, `hypothesis`, `axiom` or `data` |
| `base` | `proven`, `conditional` (proven assuming something in `needs` that is not proven) or `open` |
| `needs` | What the entry rests on. Each item is an id, or `{ "id": "...", "url": "..." }` when the link has its own source |
| `equivalent` | `true` if the entry is equivalent to the one statement in `needs`, not only a consequence |
| `related`, `formerly` | Dotted links that carry no ripple: a connected statement, or a hypothesis the result no longer needs |
| `by`, `note`, `url` | Attribution, comment, source |
| `anyOf` | Statements any one of which would prove this one (several independent routes) |
| `claim` | An unreviewed recent claim of a proof or disproof. Shown in the panel and as a pink dot; it does not change the status |
| `year`, `settled` | When the statement was first stated or proven, and, if it began as a conjecture, when it was proven. Not used by the page yet; recorded for a future timeline. Left out where no source gives a date |
| `formerlyYear` | When the result was first proven under the hypothesis in `formerly` |
| `area` | The area id of the file it is in |

What `needs` means depends on `base`:

- `proven`: the proven theorems its cited proof uses. Empty for a foundation.
- `conditional`: at least one unproven statement or axiom, plus any proven theorems the proof uses.
- `open`: "if everything in this list were proven, this would be too". Never list only proven theorems here, or the page shows the conjecture as proven. The tests catch that.

To add an area, add its file and list it in `data/index.json`.

## Deploy

GitHub Pages serves the `main` branch from the repository root. Pushing to `main` publishes.
