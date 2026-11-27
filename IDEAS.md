# Ideas not built yet

Two ideas from 27 November 2026, written down so that a later session can start from them. Neither is started. All numbers were counted on the data of that day (2,128 entries).

Before building either one: draw a picture of it from the real data with a scratch script and look at it first. The Molecule arrangement only worked on the third layout guess, and the guesses that failed were visible in a drawing within minutes.

## 1. Playback: the map grows year by year

Press play in the Molecule arrangement. The map starts empty, a year counter runs, and each entry appears in its year: balls fill up, statements appear around them, lines grow. No new arrangement is needed; every entry keeps the position `layoutMolecule` gives it.

What is there already:

- `year` on an entry is the year it was first stated or proven. `settled` (116 entries) is the year a statement that began as a conjecture was proven. `formerlyYear` (4 entries) is the year a result was first proven under a hypothesis. The page reads none of the three yet.
- What is drawn at a given zoom is decided in `updateShown` in `js/app.js` from the levels `moleculeLevels` works out. The playback is one more condition there: drawn only if the entry's year has been reached.

What stands in the way, in order of weight:

- **917 entries have no year.** 881 of them are statements from the Wikipedia import (of 1,843 imported), 3 are statements written by hand, 6 are imported axioms and 27 are systems (of 43). Only 138 of the undated statements have a dated statement directly below or on them, so guessing the year from neighbours covers few. The choices: get the years (a pass over the 881 articles with the import scripts in `tools/import/`, where `write.cjs` already reads each article's History section; the data rule in `CLAUDE.md` applies, so a year is taken from the article or left out), or show undated statements from the start as pale dots that never "appear", or leave them out of the playback. This decision comes first, because with 43% of the statements missing the playback looks wrong whatever else is done.
- **The foundations are younger than what stands on them.** ZF set theory has the year 1922, the real numbers 1872, Euclidean geometry 300 BC. Of the 519 links with a year at both ends, 76 have the upper entry older than the one it rests on (53 between statements, 22 from a statement to its system). Some of the 53 go away when `settled` is used for the year a conjecture became a theorem. For the rest a rule is needed: an entry appears in its own year even if what it rests on is not there yet, and the line is drawn once both ends exist. A system without a year appears with the first dated entry in it.
- **Years are bunched.** 11 entries before 1600, 62 from 1600 to 1799, 195 in the 1800s, 363 from 1900 to 1949, 540 from 1950 to 1999, 40 since 2000. At one constant speed the first two thousand years are nearly empty and the 20th century is a blur. Either the clock runs faster through empty stretches, or the playback steps by entries and the year counter jumps.
- **Colours.** One question for Michael: do entries appear in today's colours, or does history replay (a statement shown as open until its `settled` year, a result shown as conditional until its unconditional proof)? The second is the reason `settled` and `formerlyYear` exist.

Speed: a frame of the playback may only touch the entries that appear in it. The four things that made the page slow before are listed in `CLAUDE.md` under "Before pushing", and the three speed scripts named there have to be run before and after.

## 2. One entry in the middle

Select an entry and choose this view: everything else disappears. The entry stands in the middle, what it rests on is laid out in rows on one side (down to the axioms), what rests on it in rows on the other side. It answers "what does this depend on, and what depends on it" on one screen.

Why: the buttons in the side panel that light up what an entry rests on or what is built on it (`startTrace` in `js/app.js`) leave every entry where it is on the whole map. For a single statement that is fine. For a whole system the lit lines run across the entire map and look tangled.

What is there already:

- Each entry has the sets this view needs: `n.roots` (everything below it, following both "rests on" and the system it belongs to) and `n.above` (everything standing on it). `startTrace` uses them with the directions `'roots'` and `'above'`.
- Rows by step are what `layoutTree` does for the whole map (`layers` in `js/propagate.js`); the view is that idea applied to one entry's part of the map.

Sizes it has to cope with (counted with a quick script that also follows "would follow from" links, so the page's own counts differ slightly):

- Statements are small. 298 statements have anything standing on them, 7 have more than 20, the largest is "Sum of angles of a triangle" with 66. The longest way down belongs to the Basel problem with 45 entries below it, most of them the chain of systems down to set theory. All of this fits a screen with names readable.
- Systems are large: Group theory has 765 entries on it, Rings and fields 645, the real numbers 454; the middle one of the 43 has 81. For a system the view needs a rule, for example: draw the systems built on it and the statements that others rest on, and give the rest as a number on each system.

Open questions:

- How the view is entered and left (a button in the side panel next to the two trace buttons, Escape to go back to where the map was).
- Whether clicking an entry in the view moves that entry to the middle. It should, because it makes the view a way to walk through the map.
- Phone portrait: rows of names do not fit side by side at 375 px, so the two sides probably have to go above and below the entry there.
