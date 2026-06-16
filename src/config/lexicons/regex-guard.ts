/**
 * @module config/lexicons/regex-guard
 *
 * Shared validator for regular-expression patterns sourced from **external**
 * lexicon overlays / customRules. These patterns are compiled with `new RegExp`
 * and then run against every source line, so a hostile or pathological pattern
 * can cause catastrophic backtracking (ReDoS) and freeze the single-threaded
 * compiler/LSP.
 *
 * A real timeout is not achievable in single-threaded JS, so the strategy is:
 *   1. Reject over-long patterns at load time.
 *   2. Reject obvious nested-quantifier ReDoS shapes at load time.
 *   3. Surface compile failures (and rejections) as structured results instead
 *      of silently swallowing them.
 *   4. Callers additionally cap the input length per match (see MAX_MATCH_INPUT).
 */

/** Maximum allowed length of an overlay-supplied regex source. */
export const MAX_PATTERN_LENGTH = 1000;

/**
 * Maximum input length a guarded overlay regex is allowed to run against in a
 * single `.test()`/`.replace()` call. Longer inputs are matched line-by-line
 * already, but this is a defensive cap callers can apply.
 */
export const MAX_MATCH_INPUT = 100_000;

/**
 * Result of validating + compiling an overlay-supplied regex.
 *
 * On success `regex` is the compiled RegExp. On failure `error` describes why
 * the pattern was rejected (dangerous shape, too long, or invalid syntax).
 */
export type RegexGuardResult =
  | { ok: true; regex: RegExp }
  | { ok: false; error: string };

/**
 * Heuristic detection of nested-quantifier ReDoS shapes such as:
 *   (a+)+   (a*)*   (a+)*   (.*)+   ((ab)+)+   (a+|b)*
 *
 * These are the classic "evil regex" constructions where a quantified group
 * itself contains a quantifier, producing exponential backtracking. The check
 * is intentionally conservative: it errs toward rejecting suspicious patterns
 * rather than risking a freeze.
 */
function hasNestedQuantifier(pattern: string): boolean {
  // Walk the pattern, tracking parenthesis groups via a stack. For each closing
  // paren that is immediately followed by a quantifier (* + or {n,}), inspect
  // the group's body. If the body itself contains a quantifier OR an
  // alternation, the construct is a classic exponential-backtracking shape:
  //   (a+)+  (a*)*  (.*)+  ((ab)+)+  (a|aa)+
  // This handles arbitrarily nested groups (which a single regex can't).
  const isQuantChar = (c: string | undefined): boolean =>
    c === '*' || c === '+' || c === '{';

  const openStack: number[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      i++; // skip escaped char
      continue;
    }
    if (ch === '(') {
      openStack.push(i);
    } else if (ch === ')') {
      const open = openStack.pop();
      if (open === undefined) continue; // unbalanced; let RegExp ctor report it
      // Is this group quantified?
      const next = pattern[i + 1];
      if (!isQuantChar(next)) continue;
      // Inspect the body between the matching parens for a quantifier or
      // alternation (ignoring escapes).
      const body = pattern.slice(open + 1, i);
      if (bodyIsAmbiguous(body)) return true;
    }
  }
  return false;
}

/**
 * True if a quantified group's body itself contains a quantifier or a top-level
 * alternation — the two shapes that make an outer `+`/`*` exponential.
 */
function bodyIsAmbiguous(body: string): boolean {
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '*' || ch === '+' || ch === '|') return true;
    if (ch === '{') {
      // open-ended or upper-bounded repetition like {1,} or {2,5}
      const rest = body.slice(i);
      if (/^\{\d*,?\d*\}/.test(rest)) return true;
    }
  }
  return false;
}

/**
 * Validate and compile an overlay-supplied regex pattern.
 *
 * @param pattern - the raw pattern string from the overlay/lexicon
 * @param flags - regex flags to compile with
 * @param source - optional human-readable source label for error messages
 * @returns a discriminated result with either the compiled regex or an error
 */
export function compileGuardedRegex(
  pattern: string,
  flags = '',
  source?: string
): RegexGuardResult {
  const label = source ? `${source}: ` : '';

  if (typeof pattern !== 'string') {
    return { ok: false, error: `${label}pattern must be a string` };
  }

  if (pattern.length > MAX_PATTERN_LENGTH) {
    return {
      ok: false,
      error: `${label}pattern too long (${pattern.length} > ${MAX_PATTERN_LENGTH} chars); rejected to avoid ReDoS`,
    };
  }

  if (hasNestedQuantifier(pattern)) {
    return {
      ok: false,
      error: `${label}pattern rejected: nested quantifier (ReDoS-prone) detected in /${pattern}/`,
    };
  }

  try {
    return { ok: true, regex: new RegExp(pattern, flags) };
  } catch (e) {
    return {
      ok: false,
      error: `${label}invalid regular expression /${pattern}/: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
