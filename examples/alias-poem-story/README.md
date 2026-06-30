# Alias demo — runnable ballads

Two runnable poems — a branching story (`nightfall`) and a Match/List piece (`tides`) —
written in a custom **"Bard" dialect** of Aster, yet they compile and execute on the exact
same engine that runs production policies. The trick
is Aster's **keyword-alias mechanism** (ADR 0022): a custom *lexicon* renames the structural
keywords into bardic words, and during canonicalization those aliases normalize back to the
canonical keywords. The lexer, parser, and Core IR never see the aliases — so the "Bard
version" and the plain-keyword version compile to **structurally identical Core IR**.

## The ballad

```
Ballad nightfall.

Verse refrain of n:
  where n but 1
    sing "  one star opens in the dark,".
  where n but 2
    sing "  a second leans to join the spark,".
  sing "  a third, and then the sky is stark.".

Verse stanza of n:
  where n but 1
    sing refrain(1).
  let above become stanza(n less 1).
  sing above then "
" then refrain(n).

Verse opening of hour:
  where hour past 21
    sing "Midnight crowns the hill with frost,".
  where hour past 18
    sing "Dusk lets fall the day she lost,".
  sing "Dawn still lingers, faint and crossed,".

Verse turning of hour:
  where hour past 18
    sing "the wanderer walks on, the road uncrossed;".
  sing "the wanderer turns for home, the daylight lost;".

Verse nightsong of hour:
  sing opening(hour)
  then "
"
  then turning(hour)
  then "
"
  then stanza(3).
```

The closing verse spans lines — equal-indent **multi-line continuation** (ADR 0026): a line
beginning with the join word `then` continues the previous expression. `be` is aliased to
`become`. The string literals carry real line breaks, so the recited poem prints as stanzas.

That whole thing is **executable Aster**. No `as Int`, no `produce Text`, no
`Text.concat(...)` — yet it rhymes: the openings end **-ost / -ossed** (frost / lost /
crossed), the turnings **-ossed / -ost**, and the star refrain climbs **-ark** (dark / spark
/ stark). The recursion makes the refrain *build* — one star, a second, a third — rather than
repeat.

## Run it

```bash
pnpm build                                   # produce dist/
node examples/alias-poem-story/recite.mjs    # recite both ballads
```

One source, three fates by arrival hour:

```
⏾ hour 23:
    Midnight crowns the hill with frost,
    the wanderer walks on, the road uncrossed;
      one star opens in the dark,
      a second leans to join the spark,
      a third, and then the sky is stark.
```

## The dialect

`bard.mjs` builds a `Lexicon` by layering aliases onto `EN_US` (canonical spellings unchanged):

| Aster keyword | Bard alias | what it does                          |
|---------------|------------|---------------------------------------|
| `Module`      | `Ballad`   | declares the work                     |
| `Rule`        | `Verse`    | a named, callable verse               |
| `given`       | `of`       | a verse's input                       |
| `Let`         | `let`      | bind a line                           |
| `be`          | `become`   | binding's verb (`let earlier become …`) |
| `If`          | `where`    | a fork in the tale                    |
| `Return`      | `sing`     | yield the line                        |
| `+` (concat)  | `then`     | join verses left-to-right (infix)     |
| `at most`     | `but`      | `n but 1` ⟺ `n <= 1`                  |
| `at least`    | `past`     | `hour past 18` ⟺ `hour >= 18`         |
| `minus`       | `less`     | `n less 1` ⟺ `n - 1`                  |
| `Match`       | `behold`   | choose a verse by value               |
| `When`        | `as`       | a case (`as 0, sing …`)               |

### How the verse stays clean (no grammar changes)

- **Types vanish.** Aster's `as <Type>` and `produce <Type>` are optional — the engine
  infers them. So `Verse stars of n:` carries no type noise.
- **Joins read as verse.** The `+` operator already concatenates strings; aliasing it to
  `then` turns nested `Text.concat(Text.concat(a, b), c)` into left-associative
  `a then b then c`.
- **No double-`be`.** `Let <name> be <expr>` — aliasing only `Let`→`let` (leaving `be`
  itself) gives the natural `let earlier be …`.

### What still shows through

Three things can't be hidden by aliases alone (they'd need grammar changes, out of scope):

- **Call parentheses:** `stars(n less 1)`, `sky(hour)` — calls require `(...)`.
- **A trailing period:** every statement ends with `.` — though a period reads as a poetic
  full stop / caesura, so it's kept on purpose.
- **Digit literals:** `but 1`, `past 18` — numbers must be Arabic digits (no word-numbers).

## How the poem works

`nightfall.ballad.aster` is **a story and a refrain in one module**:

- **A building refrain.** `refrain(n)` gives a different line per depth (one / a second / a
  third); `stanza(n)` stacks them with line breaks via recursion — so the star-image *climbs*
  rather than repeats.
- **A branching story.** `opening(hour)` and `turning(hour)` fork on the hour of arrival (guard
  clauses: each `where … sing` returns when true, else falls through). `nightsong(hour)` weaves
  the opening, the turning, and the stanza into a lined poem. The *same* source yields three
  different fates depending on `hour`.

## A second ballad — TIDES (Match + List)

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
