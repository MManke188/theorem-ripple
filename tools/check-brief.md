# Brief: checking one area file of the Theorem Ripple map

Theorem Ripple is a public web page that draws mathematical statements as a graph where a link means "B rests on A". Another agent wrote the entries for one area. Your job is to find what is wrong in that file. Do not confirm it out of politeness: in the previous round a checker found errors in 17 of 46 entries.

Read `tools/research-brief.md` first. It is the brief the author worked from and defines every field, in particular what `needs` means for proven, conditional and open entries.

Do NOT edit any file. Report only.

## What to check, per entry

Use web search and fetch the pages. Do not rely on memory, and do not rely on the author's URL alone when a claim is surprising.

1. **Statement**: mathematically accurate as written? Constants, ranges, quantifiers, "for all sufficiently large", dimension, exact inequality.
2. **Attribution**: person and year in `by`.
3. **Status** (`base`): is it really proven, conditional, or open as of November 2026? Has an open conjecture been settled, or a proof been withdrawn or disputed?
4. **Every link in `needs`**, which is the most important part:
   - Does a source actually say B depends on A (the proof uses A, or B was proven assuming A)?
   - Is the direction right? A common mistake is writing the implication backwards.
   - Is the hypothesis exactly the one needed, not a weaker or stronger relative?
   - For an open entry: would proving everything in `needs` really prove it?
   - `equivalent: true`: is it a genuine two-way equivalence?
5. **`related` and `formerly`**: reasonable and true?
6. **URL**: does it load and support the entry? If not, give a better one.
7. **Wording**: is the statement understandable and free of errors a specialist would wince at? Flag em dashes used as punctuation and hype.

Also look at the file as a whole: missing famous links between entries that are already in the file (give a source), and entries that should be dropped as too shaky.

## Report format

One line per entry id, in file order:
- `OK` plus the URL you verified against, or
- `FIX` plus the exact corrected field values (statement / by / base / needs / equivalent / related / url / note) and the source URL that shows it, or
- `UNVERIFIED` plus what you tried.

Then three short lists: links to add between existing entries (with source), entries to drop, and anything where sources disagree. Keep the report compact: no praise, no restating of entries that are fine.
