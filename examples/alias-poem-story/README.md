# Alias demo — a runnable ballad

A poem **and** a branching story, written in a custom **"Bard" dialect** of Aster — yet
it compiles and executes on the exact same engine that runs production policies. The trick
is Aster's **keyword-alias mechanism** (ADR 0022): a custom *lexicon* renames the structural
keywords into bardic words, and during canonicalization those aliases normalize back to the
canonical keywords. The lexer, parser, and Core IR never see the aliases — so the "Bard
version" and the plain-keyword version compile to **structurally identical Core IR**.

## The ballad

```
Ballad nightfall.

Verse stars of n:
  where n but 1
    sing "a single star".
  let earlier become stars(n less 1).
  sing earlier then ", then another star".

Verse sky of hour:
  where hour past 21
    sing "midnight crowns the hill, ".
  where hour past 18
    sing "dusk unfolds her veil, ".
  sing "dawn still lingers low, ".

Verse fate of hour:
  where hour past 18
    sing "and the wanderer walks on, counting ".
  sing "and the wanderer turns home, leaving ".

Verse nightsong of hour:
  let opening become sky(hour).
  let turning become fate(hour).
  let heavens become stars(3).
  sing opening
  then turning
  then heavens.
```

The closing verse spans three lines — equal-indent **multi-line continuation** (ADR 0026):
a line beginning with the join word `then` continues the previous expression. And `be` is
aliased to `become`, so bindings read `let opening become sky(hour)`.

That whole thing is **executable Aster**. No `as Int`, no `produce Text`, no
`Text.concat(...)` — it reads as verse.

## Run it

```bash
pnpm build                                   # produce dist/
node examples/alias-poem-story/recite.mjs    # recite at hours 08 / 19 / 23
node examples/alias-poem-story/recite.mjs 18 # recite at one chosen hour
```

One source, three fates by arrival hour:

```
⏾ hour 08: dawn still lingers low, and the wanderer turns home, leaving a single star, then another star, then another star
⏾ hour 19: dusk unfolds her veil, and the wanderer walks on, counting a single star, then another star, then another star
⏾ hour 23: midnight crowns the hill, and the wanderer walks on, counting a single star, then another star, then another star
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

`nightfall.ballad.aster` is **two forms in one module**:

- **A recursive poem.** `stars(n)` sings "a single star" at the base case and, for larger `n`,
  joins the earlier verse with ", then another star" — a cumulative stanza built by recursion.
- **A branching story.** `sky(hour)` and `fate(hour)` fork on the hour of arrival (guard
  clauses: each `where … sing` returns when true, else falls through). `nightsong(hour)`
  binds three named images — `opening`, `turning`, `heavens` — and the closing line weaves
  them with no parentheses in sight: `sing opening then turning then heavens.` The *same*
  source yields three different fates depending on `hour`.

## Why this matters

It's a playful demo, but it shows something real about Aster's design: the **surface
vocabulary is fully decoupled from the executable core**. The same separation that lets a
business write rules in localized, domain-specific words (insurance, lending, …) — or in
Chinese / German / Hindi — also lets a poet write a ballad. The engine only ever sees the
canonical Core IR, so determinism, dual-engine parity, and provability are untouched.

The CI regression test lives at `test/unit/alias-poem-story.test.ts` — it asserts the ballad
compiles, recites the expected fates at each hour, runs with types fully omitted, and that
the Bard dialect lowers to the same Core IR as plain keywords.
