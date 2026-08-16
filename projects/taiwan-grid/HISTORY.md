# 台灣九宮格 — Changelog

Versioning: `MAJOR.MINOR.PATCH`

## [0.1.0] — 2026-08-16

First numbered release. Development before this point was unversioned; this is the
baseline.

## Current State

- 272 people
- no score, only correct/incorrect
- puzzles for the first 10 days only

### Changed

- **Renumbered every person id** to a flat sequential `tw-001` … `tw-272`, replacing the
  two schemes that had been used side by side: `tw-s001` (with a category letter prefix)
  and `Q238819` (raw Wikidata ids). Ids are now treated as immutable and meaningless; the
  category letter was dropped because it invited renaming whenever someone crossed over
  between fields, which is precisely the thing that breaks saved games.
- **Added a `wikidata` field** to every person, positioned after `name`. The 10 people who
  previously used a Q id as their primary key keep it here; the other 262 are an empty
  string, to be filled in opportunistically. Useful for deduplicating when adding people,
  linking out to sources, and potentially auto-populating `properties` from Wikidata later.
- **Bumped `STORE_KEY` from `twgrid.v2` to `twgrid.v3`.** Saved games record results as
  person ids, so renumbering made every existing save unresolvable. The old `twgrid.v2`
  data is not deleted, just no longer read.
- **Added `VERSION` and `HISTORY.md`**, with the version number shown in the page footer.

### Fixed

- The insights screens (九宮格詳解 / 猜錯分析) dereferenced `byId.get(pid).name` directly.
  If a saved game referenced an id no longer in `people.json`, this threw a TypeError and
  took out the entire screen. Name lookups now go through `nameOf()`, which falls back to
  displaying the raw id, so a future id mistake is a cosmetic glitch rather than a crash.
- The wrong-guess popup had the same problem and could not be fixed the same way, because
  explaining *why* a guess failed needs the full person object for `matches()`, not just a
  name. Unresolvable guesses are now skipped; the "猜錯 N 次" count stays accurate.

### Impact

- **Anyone who played before this version lost all saved history** and started clean. Only
  3 puzzles had shipped, over roughly two days, so the breaking change was done in one pass
  rather than left to rot in the data.

---


## Conventions

**Person ids are immutable.** `people.json` ids (`tw-001`, `tw-002`, …) are opaque keys.
They carry no meaning — a person's category comes from `properties.occupation`, never from
the id. Saved games store these ids, so renaming one orphans real player history.

> ⚠️ If you ever do change person ids, you **must** bump `STORE_KEY` in `grid.js` in the
> same commit. Otherwise old saves point at people who no longer exist. See 0.1.0.

**Past 999 people, just keep counting: `tw-1000`.** No code parses, sorts, or does
arithmetic on person ids — they are only map keys and `data-pid` attributes — so the digit
width is purely cosmetic alignment in the JSON file. Do not switch to a new scheme
(`tw-a01` etc.), and do not renumber to a wider zero-pad, which would be a MAJOR bump for
no functional gain. The one thing to watch: mixed widths don't sort lexicographically
(`tw-1000` < `tw-999` as strings). If you ever need ids in order, sort on the numeric tail
(`+id.slice(3)`).

**`wikidata` is optional.** Empty string when the person has no Wikidata entry. Never
promote it back to the primary key — plenty of people worth including (local politicians,
YouTubers, indie musicians) have no Q id at all.
