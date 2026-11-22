# Brief: writing entries for the Theorem Ripple map

Theorem Ripple is a public web page (https://mmanke188.github.io/theorem-ripple/) that draws mathematical statements as a graph. A link means **"B rests on A"**. The page answers "what does this change?" (everything downstream of a node) and "what does this rest on?" (everything upstream). Readers are curious non-specialists.

You are writing the entries for ONE area as a JSON file. A fresh agent will later try to find errors in your file, so accuracy matters more than volume.

## The one rule that matters

In the last round, entries written from memory were wrong in detail 17 times out of 46 (wrong year, wrong constant, wrong hypothesis). So:

- For EVERY entry, open a source (web search, then fetch the page) and take the statement, the attribution and the year from it. Record that URL in `url`.
- For EVERY link in `needs`, have a source that says B depends on A: the proof of B uses A, or B was proven assuming A. If that source is not the entry's own `url`, write the link as `{ "id": "A", "url": "..." }`.
- If you cannot confirm an entry or a link, leave it out. Do not guess. A smaller correct file is the goal.
- Prefer specific Wikipedia sections, arXiv abstracts, journal pages, or well-known expository sources (Tao's blog, survey papers). Check that the URL loads and actually supports the claim.

## File format

Write `data/<area>.json` (the exact file name is in your task), UTF-8, 2-space indent:

```json
{
  "area": "<area id>",
  "nodes": [ { ...entry... }, ... ]
}
```

Look at `data/number-theory.json` for 46 finished examples. Each entry:

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | lowercase-with-hyphens, unique across the whole project (ids already taken are listed in your task) |
| `name` | yes | Full name, as a mathematician would call it |
| `short` | yes | Label on the map, at most 26 characters |
| `statement` | yes | The claim in one or two plain sentences. Unicode symbols, no LaTeX. Understandable to someone with school mathematics where that is possible |
| `kind` | yes | `"theorem"` (a result), `"hypothesis"` (a conjecture or hypothesis), or `"axiom"` (an axiom people choose to assume, such as the axiom of choice) |
| `base` | yes | `"proven"`: proven today with no unproven assumption. `"conditional"`: proven, but only assuming something unproven or an axiom listed in `needs`. `"open"`: not proven (all conjectures and all axioms) |
| `needs` | yes | List of ids this entry rests on. May be empty. See below |
| `equivalent` | no | `true` if the entry is known to be equivalent to the single thing in `needs`, not only a consequence |
| `related` | no | Ids of entries that are closely connected but where neither rests on the other (drawn as a dotted line) |
| `formerly` | no | For a `proven` entry: ids of hypotheses it was first proven under and no longer needs |
| `by` | yes | Who and when, e.g. "Andrew Wiles and Richard Taylor, 1995". For conditional results: who proved it under the assumption |
| `note` | no | One or two plain sentences of context: why it matters, or what the link means |
| `url` | yes | The source you opened |
| `area` | yes | Your area id |

## What `needs` means, exactly

- `base: "proven"` entry: `needs` lists the proven theorems (in this project) that its standard or original proof uses in an essential, documented way. Example: Fermat's Last Theorem needs the modularity theorem for semistable curves and Ribet's theorem. Only list dependencies a source states. Leave `needs` empty for foundations.
- `base: "conditional"` entry: `needs` must contain at least one entry that is not proven (a hypothesis or an axiom). It may also list proven theorems the proof uses.
- `base: "open"` entry: `needs` means "if everything in this list were proven, this would be proven too". Use it for a conjecture that follows from a stronger conjecture (Lindelöf follows from the Riemann Hypothesis). NEVER put only proven theorems in the `needs` of an open entry: the page would then show the conjecture as proven. For "this conjecture is about / generalises that theorem", use `related`.
- No cycles. If two statements are equivalent, pick one as the base and mark the other `equivalent: true`.
- Only use ids that exist: in your own file, or in the list of taken ids if your task allows it.

## What makes a good set

- A few **foundations**: proven theorems or open conjectures that several other entries rest on.
- Real **chains**: A, then B which rests on A, then C which rests on B. Depth 3 or more where the mathematics really has it.
- A mix of statuses: proven foundations and what was built on them, open conjectures and the results proven only if they hold, and a few open problems that nothing here settles.
- Famous, checkable statements over obscure ones.
- Every entry should have at least one link (`needs`, `related`, `formerly`, or being needed by another entry). No isolated nodes.

## Wording

Plain declarative sentences. No hype, no rhetorical questions, no em dashes or en dashes used as punctuation (hyphenated names such as "Green–Tao" are fine). The text is read by people who were not in the room.

## When you are done

1. Check the file parses: `node -e "JSON.parse(require('fs').readFileSync('<file>','utf8'))"`.
2. Do not edit any other file in the project.
3. Report back, briefly:
   - number of entries written,
   - entries or links from the target list you left out and why,
   - **suggested links into other areas** (by statement name, with a source URL each), since you could not reference those ids,
   - anything you are unsure about, so the checker can look at it first.
