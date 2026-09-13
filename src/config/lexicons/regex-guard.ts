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
 * 检测**相邻量词**歧义：`a*a*b`、`a+a+b`、`\d*\d*x` 这类。
 *
 * <h2>★为什么 {@link hasNestedQuantifier} 抓不到它</h2>
 *
 * 那个检查只看「被量词修饰的**分组**」，而歧义**不需要分组**即可产生：
 * 两个相邻的、能匹配**同一字符集**的量词，会让「这个 a 归左边还是右边」
 * 产生 2^n 种切分，后缀失配时全部被穷举。
 *
 * <p>实测（独立审查者发现，我已复现）：
 * <pre>
 *   a*a*a*a*a*a*a*a*a*a*b   ← 守卫 ACCEPTED，24 字符输入耗时 1705ms（每 +2 字符翻倍）
 *   a+a+a+a+a+a+a+a+b       ← 守卫 ACCEPTED，同样指数
 * </pre>
 *
 * <p>★TS 侧**没有看门狗兜底**（Java 侧的 {@code replaceAllWithTimeout} 有），
 * 单线程 JS 下这就是无限挂死。
 *
 * <h2>判据</h2>
 *
 * 相邻两个「原子 + 量词」，且两个原子**文本相同**（保守：只认完全相同的原子，
 * 不做字符集交集分析）。这样 {@code a*b*c} 这类不同原子的不会被误伤。
 */
function hasAdjacentAmbiguousQuantifier(pattern: string): boolean {
  /** 从 i 处解析一个「原子 + 量词」，返回 [原子文本, 下一个位置]；无量词则返回 null。 */
  const readQuantifiedAtom = (s: string, i: number): [string, number] | null => {
    let atomStart = i;
    let j = i;
    if (s[j] === '\\') {
      j += 2;                                   // 转义原子，如 \d \w \.
    } else if (s[j] === '[') {                  // 字符类
      j++;
      while (j < s.length && s[j] !== ']') { if (s[j] === '\\') j++; j++; }
      j++;
    } else if (s[j] === '(' || s[j] === ')' || s[j] === '|') {
      return null;                              // 分组由 hasNestedQuantifier 负责
    } else {
      j++;                                      // 单字符原子
    }
    const atom = s.slice(atomStart, j);
    const q = s[j];
    if (q === '*' || q === '+') return [atom, j + 1];
    if (q === '{') {
      const m = /^\{\d*,\d*\}|^\{\d*,\}/.exec(s.slice(j));   // 开区间重复才有歧义
      if (m) return [atom, j + m[0].length];
    }
    return null;
  };

  for (let i = 0; i < pattern.length; i++) {
    const first = readQuantifiedAtom(pattern, i);
    if (first === null) {
      if (pattern[i] === '\\') i++;             // 跳过转义
      continue;
    }
    const second = readQuantifiedAtom(pattern, first[1]);
    if (second !== null && second[0] === first[0]) return true;
    i = first[1] - 1;
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

  if (hasAdjacentAmbiguousQuantifier(pattern)) {
    return {
      ok: false,
      error: `${label}pattern rejected: adjacent ambiguous quantifier (ReDoS-prone) detected in /${pattern}/`
        + ' — e.g. `a*a*b`: two quantifiers over the same atom make the split exponential',
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
