# Alias demo — when the source is the poem

Two takes on "a poem that is also a program", via Aster's **keyword-alias mechanism**
(ADR 0022): a custom *lexicon* renames the structural keywords, and during canonicalization
those aliases normalize back to canonical keywords. The lexer, parser, and Core IR never see
the aliases — so the aliased source and the plain-keyword version compile to **structurally
identical Core IR**.

- **`nightfall`** — the **source itself is a poem**: read the `.aster` top-to-bottom and it
  scans as verse; it also runs.
- **`tides`** — the source is the Bard dialect, and the **running output** is a rhymed poem
  (Match picks the image, List counts the surf).

## NIGHTFALL — the source is the poem

The whole `.aster` file reads as a poem:

```
Nightfall comes.

I gather count stars:
  while stars but 1
    sing "and one last light to keep the dark from me".
  let earlier be gather(stars less 1).
  sing earlier with " and one more light to set the evening free".
```

…and it is **executable Aster**. The `Nightfall (English)` dialect aliases the keywords so each
line scans as verse: `Module`→`Nightfall` (the title `Nightfall comes.` — `comes` is the
module name), `Rule`→`I`, `given`→`count`, `If`→`while`, `Return`→`sing`, `Let`→`let`, `be`→`be`,
`+`→`with` (join), `minus`→`less`, `at most`→`but`. No `as Int` / `produce Text` (inferred).
The two end-words rhyme: **me / free**.

Running it recursively gathers the lights one by one:

```
✦ 1 star:  and one last light to keep the dark from me
✦ 2 stars: and one last light to keep the dark from me and one more light to set the evening free
```

### The one seam

A recursive call needs parentheses — `gather(stars less 1)` — and the grammar can't hide
them; that single line is the one place the program shows through the poem. Everything else
reads as verse. (A trailing `.` ends each statement too, but a period reads as a full stop.)

## Run it

```bash
pnpm build                                   # produce dist/
node examples/alias-poem-story/recite.mjs    # print both poems + run them
```

It prints each `.aster` source, then runs it.

## What aliases can hide (and what they can't)

`bard.mjs` builds each dialect by layering aliases onto `EN_US` (canonical spellings unchanged).
Two general lessons the poems lean on:

- **Types vanish.** Aster's `as <Type>` / `produce <Type>` are optional — the engine infers
  them, so no type noise on the page.
- **Joins read as verse.** The `+` operator concatenates strings; aliasing it to a word
  (`with` / `then`) turns nested `Text.concat(...)` into an infix chain. Across equal-indent
  lines it even spans the page (ADR 0026 multi-line continuation).

Three seams aliases can't remove (they'd need grammar changes, out of scope):

- **Call parentheses** — `gather(stars less 1)`, `moon(phase)`.
- **A trailing `.`** on each statement (reads as a full stop).
- **Digit literals** — `but 1`, `phase 0` — numbers must be Arabic digits.

## TIDES — the running output is the poem (Match + List)

`tides.ballad.aster` shows two more language features, also in rhyme:

```
Verse moon of phase:
  behold phase:
    as 0, sing "The new moon hides; the cove lies black and deep,".
    as 1, sing "The crescent leans; the shallows stir from sleep,".
    as 2, sing "The full moon climbs; the breakers rise to leap,".
    as 3, sing "The old moon wanes; the long grey waters creep,".

Verse swell of count:
  let crests become List.range(1, count).
  let height become List.sum(crests).
  behold height:
    as 0, sing "and not one wave to keep.".
    as 1, sing "and a single tide to keep.".
    as 3, sing "and a rising tide to keep.".
    as 6, sing "and a flood the shore will keep.".

Verse seasong of phase:
  sing moon(phase)
  then "
"
  then swell(phase plus 1).
```

- **`behold` is `Match`** — `moon(phase)` picks the omen by the moon's phase (each `as` is a
  `When` case). The moon lines all rhyme **-eep**: deep / sleep / leap / creep.
- **`List` drives the imagery, not a printed number.** `swell(count)` ranges `1..count` and
  sums it (a triangular number), then a *second* `behold` turns that height into a tidal image
  (`not one wave` / `a single tide` / `a rising tide` / `a flood`) — the computation stays in
  the engine, the image is on the page (and rhymes **-eep**: keep).

Reciting the four phases:

```
☾ phase 2:
    The full moon climbs; the breakers rise to leap,
    and a rising tide to keep.
☾ phase 3:
    The old moon wanes; the long grey waters creep,
    and a flood the shore will keep.
```

## Why this matters

It's a playful demo, but it shows something real about Aster's design: the **surface
vocabulary is fully decoupled from the executable core**. The same separation that lets a
business write rules in localized, domain-specific words (insurance, lending, …) — or in
Chinese / German / Hindi — also lets a poet write a ballad. The engine only ever sees the
canonical Core IR, so determinism, dual-engine parity, and provability are untouched.

The CI regression test lives at `test/unit/alias-poem-story.test.ts` — it asserts the ballad
compiles, recites the expected fates at each hour, runs with types fully omitted, and that
the Bard dialect lowers to the same Core IR as plain keywords.
