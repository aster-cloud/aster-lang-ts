/**
 * 包格式 v1 的严格 JSON 读取（aster-lang-test `conformance/package-v1/README.md`「严格 JSON」）。
 *
 * `manifest.json`、`manifest.sig.json`、`tests/probes.json` 与 `--input` 都按同一语法读：各 JSON 库的缺省宽容度不同
 * （Jackson 跳过 BOM、接受尾随 token；`JSON.parse` 对重复键取后者），两个 CLI 只有都显式检查才能给出同一错误码。
 *
 *   - 字节是合法 UTF-8，且不以 BOM 开头；
 *   - RFC 8259 语法：恰好一个值，前后只允许空格、`\t`、`\n`、`\r`；字符串内不得有未转义的控制字符；
 *   - 对象内不得有重复键（按解码后的字符串比较）；字符串（含键）解码后不得含孤立代理项；
 *   - 嵌套深度（对象 / 数组层数）不超过 `maxDepth`；数字溢出为 ±Infinity 即失败；
 *   - `lossless` 时不含 `.` `e` `E` 的数字 token 读成 bigint（精确整数），其余读成 number。
 *
 * 与参照实现 `scripts/lib/package-v1/strict-json.mjs` 同一判定。对象以普通对象承载、逐键 `defineProperty`
 * 写入，键 `__proto__` 只是普通自有属性，不会改动原型。
 */

/** 严格 JSON 解析得到的值。lossless 时整数为 bigint。 */
export type JsonValue = null | boolean | number | bigint | string | JsonValue[] | { [key: string]: JsonValue };

/** 失败原因，仅供诊断（stderr），不进信封。 */
export type StrictJsonReason = 'bom' | 'utf8' | 'syntax' | 'duplicate' | 'surrogate' | 'depth' | 'range' | 'trailing';

export class StrictJsonError extends Error {
  constructor(
    readonly reason: StrictJsonReason,
    message: string,
  ) {
    super(`${reason}: ${message}`);
    this.name = 'StrictJsonError';
  }
}

export interface StrictJsonOptions {
  /** 最大嵌套层数（缺省 64） */
  readonly maxDepth?: number;
  /** 整数 token 是否读成 bigint（缺省 false） */
  readonly lossless?: boolean;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** 字符串是否含孤立代理项（等价于 ES2024 `!s.isWellFormed()`，本仓 lib 目标为 ES2022）。 */
export function hasLoneSurrogate(s: string): boolean {
  return LONE_SURROGATE.test(s);
}

const ESCAPES: Readonly<Record<string, string>> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
const HEX4 = /^[0-9a-fA-F]{4}$/;
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const INTEGER_TOKEN = /^-?(?:0|[1-9][0-9]*)$/;

/** 字节是否以 UTF-8 BOM 开头。 */
function startsWithBom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

/** 把字节严格解码为 UTF-8 文本（非法序列与 BOM 都失败）。 */
export function decodeUtf8Strict(bytes: Uint8Array): string {
  if (startsWithBom(bytes)) throw new StrictJsonError('bom', '以 UTF-8 BOM 开头');
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new StrictJsonError('utf8', '不是合法 UTF-8');
  }
}

/** 按 README「严格 JSON」解析字节或已解码文本。 */
export function parseStrictJson(input: Uint8Array | string, options: StrictJsonOptions = {}): JsonValue {
  const text = typeof input === 'string' ? input : decodeUtf8Strict(input);
  return new Parser(text, options.maxDepth ?? 64, options.lossless ?? false).parseDocument();
}

class Parser {
  private i = 0;

  constructor(
    private readonly text: string,
    private readonly maxDepth: number,
    private readonly lossless: boolean,
  ) {}

  parseDocument(): JsonValue {
    const v = this.value(0);
    this.ws();
    if (this.i !== this.text.length) throw new StrictJsonError('trailing', `值之后有多余内容（位置 ${this.i}）`);
    return v;
  }

  private ws(): void {
    const t = this.text;
    while (this.i < t.length) {
      const c = t.charCodeAt(this.i);
      if (c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return;
      this.i++;
    }
  }

  private syntax(what: string): never {
    throw new StrictJsonError('syntax', `${what}（位置 ${this.i}）`);
  }

  private value(depth: number): JsonValue {
    this.ws();
    const c = this.text[this.i];
    if (c === '{' || c === '[') {
      if (depth + 1 > this.maxDepth) throw new StrictJsonError('depth', `嵌套深度超过 ${this.maxDepth}`);
      return c === '{' ? this.object(depth) : this.array(depth);
    }
    if (c === '"') return this.string();
    for (const [word, v] of [['true', true], ['false', false], ['null', null]] as const) {
      if (this.text.startsWith(word, this.i)) {
        this.i += word.length;
        return v;
      }
    }
    return this.number();
  }

  private object(depth: number): JsonValue {
    this.i++;
    const out: { [key: string]: JsonValue } = {};
    const seen = new Set<string>();
    this.ws();
    if (this.text[this.i] === '}') {
      this.i++;
      return out;
    }
    for (;;) {
      this.ws();
      if (this.text[this.i] !== '"') this.syntax('期望键');
      const key = this.string();
      if (seen.has(key)) throw new StrictJsonError('duplicate', `重复键 ${JSON.stringify(key)}`);
      seen.add(key);
      this.ws();
      if (this.text[this.i] !== ':') this.syntax('期望 :');
      this.i++;
      Object.defineProperty(out, key, { value: this.value(depth + 1), enumerable: true, writable: true, configurable: true });
      this.ws();
      const c = this.text[this.i];
      this.i++;
      if (c === ',') continue;
      if (c === '}') return out;
      this.i--;
      this.syntax('期望 , 或 }');
    }
  }

  private array(depth: number): JsonValue {
    this.i++;
    const out: JsonValue[] = [];
    this.ws();
    if (this.text[this.i] === ']') {
      this.i++;
      return out;
    }
    for (;;) {
      out.push(this.value(depth + 1));
      this.ws();
      const c = this.text[this.i];
      this.i++;
      if (c === ',') continue;
      if (c === ']') return out;
      this.i--;
      this.syntax('期望 , 或 ]');
    }
  }

  /**
   * 字符串按字符逐个扫描：不用 `(?:…|…)*` 形式的正则——V8 对长输入回溯会栈溢出，16 MiB 以内的合法字符串也会触发
   * （与参照实现同一修正，aster-lang-test#217）。
   */
  private string(): string {
    const t = this.text;
    if (t[this.i] !== '"') this.syntax('期望字符串');
    let i = this.i + 1;
    const parts: string[] = [];
    let start = i;
    for (;;) {
      if (i >= t.length) {
        this.i = i;
        this.syntax('字符串未结束');
      }
      const c = t.charCodeAt(i);
      if (c === 0x22) break;
      if (c < 0x20) {
        this.i = i;
        this.syntax('字符串内有未转义的控制字符');
      }
      if (c !== 0x5c) {
        i++;
        continue;
      }
      parts.push(t.slice(start, i));
      const e = t[i + 1];
      if (e === 'u' && HEX4.test(t.slice(i + 2, i + 6))) {
        parts.push(String.fromCharCode(parseInt(t.slice(i + 2, i + 6), 16)));
        i += 6;
      } else if (e !== undefined && Object.hasOwn(ESCAPES, e)) {
        parts.push(ESCAPES[e]!);
        i += 2;
      } else {
        this.i = i;
        this.syntax('非法转义');
      }
      start = i;
    }
    parts.push(t.slice(start, i));
    this.i = i + 1;
    const s = parts.join('');
    if (hasLoneSurrogate(s)) throw new StrictJsonError('surrogate', '字符串含孤立代理项');
    return s;
  }

  private number(): JsonValue {
    NUMBER.lastIndex = this.i;
    const m = NUMBER.exec(this.text);
    if (!m) this.syntax('非法值');
    const tok = m[0];
    this.i += tok.length;
    if (this.lossless && INTEGER_TOKEN.test(tok)) return BigInt(tok);
    const n = Number(tok);
    if (!Number.isFinite(n)) throw new StrictJsonError('range', `数字溢出 ${tok}`);
    return n;
  }
}

/** 值是否为（非数组、非 null 的）JSON 对象。 */
export function isJsonObject(v: unknown): v is { [key: string]: JsonValue } {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
