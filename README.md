# Theorem Ripple

A map of mathematical results that were proven only on condition of the Riemann Hypothesis or one of its stronger relatives. Switch from "Before 20 Nov 2026" to "Today" and the proof spreads through the graph: every result that relied on the hypothesis turns green, then the results that relied on those. Results that need a second, still open hypothesis stay amber.

Select any open hypothesis and press "What if this is proven?" to see what would follow from it. What-if results are drawn in blue so they cannot be mistaken for proven ones.

## Run it

Plain HTML, CSS and JavaScript, no build step. It needs a web server because it loads `data/theorems.json`:

```
python3 -m http.server 8377
```

Then open http://127.0.0.1:8377/.

## Tests

```
node --test
```

They cover the dependency logic in `js/propagate.js` and check `data/theorems.json` for unknown ids and cycles.

## Adding results

Everything shown comes from `data/theorems.json`. One entry per statement:

| Field | Meaning |
| --- | --- |
| `id`, `name`, `short` | Identifier, full name, label on the map |
| `statement` | The claim in one sentence |
| `kind` | `hypothesis`, `theorem` or `data` |
| `base` | `open`, `conditional` (proven assuming `needs`) or `proven` |
| `needs` | Ids that must all be proven for this one to be proven. For a hypothesis: what it would follow from |
| `equivalent` | `true` if the statement is equivalent to what it needs, not only a consequence |
| `related`, `formerly` | Dashed links that carry no ripple: a related open problem, or a hypothesis the result no longer needs |
| `by`, `note`, `url` | Attribution, comment, source |

`today.proven` lists what counts as proven in the "Today" view. `today.claimed` lists statements that are claimed but not confirmed; they stay open.

## Deploy

GitHub Pages serves the `main` branch from the repository root. Pushing to `main` publishes.
