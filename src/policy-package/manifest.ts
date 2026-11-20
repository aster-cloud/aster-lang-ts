/**
 * manifest 阶段（README「检查顺序」manifest 行、「manifest 语义规则」，ADR 0059 修订 2 R3 / R6 / R10）。
 *
 * 顺序固定：① 大小 ≤ 1 MiB ② 严格 JSON ③ 数字都是安全整数且**文件字节**逐字节等于其规范 JSON
 * ④ `format` / `formatVersion` 语法 ⑤ 主版本 = 1、次版本 ≤ 1 ⑥ 按该次版本自己的 schema ⑦ 语义规则 ⑧ `coreIr.version` = 2。
 * 格式版本先于 schema（修订 2 R3）：带新字段的 1.2 manifest 报 `PKG_UNSUPPORTED_FORMAT` 而不是 `PKG_INVALID_MANIFEST`。
 * 1.1（ADR 0059 修订 4 D2）= 1.0 + 可选顶层成员 `display`；1.0 包里出现 `display` 仍被 1.0 schema 拒绝。
 */
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { canonicalJson } from '../core/canonical-json.js';
import { fail } from './errors.js';
import { compareUtf8, MAX_MANIFEST_BYTES } from './paths.js';
import { isJsonObject, parseStrictJson, type JsonValue } from './strict-json.js';
import manifestSchema from './schema/manifest-1.0.schema.json' with { type: 'json' };
import manifestSchema11 from './schema/manifest-1.1.schema.json' with { type: 'json' };
import sigSchema from './schema/sig-1.0.schema.json' with { type: 'json' };

/** 本 CLI 支持的格式标识与版本。 */
export const PACKAGE_FORMAT = 'aster-policy-package';
export const SUPPORTED_FORMAT_VERSIONS = ['1.0', '1.1'] as const;
/** 支持的最高次版本（主版本恒为 1）。 */
const MAX_MINOR = 1;
/** 显示排版的两个固定路径（修订 4 D1）。 */
const DISPLAY_FILES = ['policy/display/display.aster', 'policy/display/layout.json'] as const;
export const SUPPORTED_CORE_IR_VERSIONS = [2] as const;

const FORMAT_VERSION = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})(?![\s\S])/;

export interface ManifestEntry {
  readonly function: string;
  readonly default: boolean;
  readonly inputSchema: string;
  readonly outputSchema: string;
}

export interface ManifestFile {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

/** 通过 schema 的 manifest（只列出 CLI 读取的字段；其余字段原样保留在对象里）。 */
export interface Manifest {
  readonly format: string;
  readonly formatVersion: string;
  readonly target: 'node' | 'jre';
  readonly mode: 'a' | 'b';
  readonly policy: { readonly moduleName: string; readonly entries: readonly ManifestEntry[] } & Record<string, JsonValue>;
  readonly source: { readonly sha256: string; readonly locale: string; readonly allowStructural: boolean } & Record<string, JsonValue>;
  readonly coreIr: { readonly version: number; readonly sha256: string; readonly positionFreeSha256: string; readonly toolchainId: string };
  readonly effects: Record<string, JsonValue>;
  readonly governance: { readonly factSources: readonly string[] } & Record<string, JsonValue>;
  readonly runtime: Record<string, JsonValue>;
  readonly tests: { readonly probes: number; readonly probesSha256: string } & Record<string, JsonValue>;
  readonly files: readonly ManifestFile[];
  /** 1.1：显示排版（存在 ⇒ files[] 含两个显示文件） */
  readonly display?: { readonly layoutVersion: number };
}

let manifestValidator: ValidateFunction | undefined;
let manifestValidator11: ValidateFunction | undefined;
let sigValidator: ValidateFunction | undefined;

/** manifest schema 校验器（ajv 2020 `strict:true`），首次使用时编译。 */
export function validateManifestSchema(tree: unknown, minor = 0): boolean {
  if (minor === 1) {
    manifestValidator11 ??= new Ajv2020({ strict: true }).compile(manifestSchema11);
    return manifestValidator11(tree);
  }
  manifestValidator ??= new Ajv2020({ strict: true }).compile(manifestSchema);
  return manifestValidator(tree);
}

/** `manifest.sig.json` schema 校验器。 */
export function validateSigSchema(tree: unknown): boolean {
  sigValidator ??= new Ajv2020({ strict: true }).compile(sigSchema);
  return sigValidator(tree);
}

/**
 * ①–③：文件字节是否为严格 JSON 且逐字节等于其规范 JSON（数字只允许安全整数）。返回解析结果。
 * 签名向量与 manifest 阶段共用；失败一律 `PKG_INVALID_MANIFEST`。
 */
export function parseCanonicalManifest(bytes: Uint8Array): JsonValue {
  if (bytes.length > MAX_MANIFEST_BYTES) fail('manifest', 'PKG_INVALID_MANIFEST', 'manifest 超过 1 MiB');
  let tree: JsonValue;
  try {
    tree = parseStrictJson(bytes, { maxDepth: 64 });
  } catch (e) {
    return fail('manifest', 'PKG_INVALID_MANIFEST', `不是严格 JSON：${(e as Error).message}`);
  }
  let canon: string;
  try {
    canon = canonicalJson(tree);
  } catch (e) {
    return fail('manifest', 'PKG_INVALID_MANIFEST', `不在规范域内：${(e as Error).message}`);
  }
  if (!Buffer.from(canon, 'utf8').equals(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))) {
    fail('manifest', 'PKG_INVALID_MANIFEST', '文件字节不是规范 JSON');
  }
  return tree;
}

/** ⑦：schema 表达不了的语义规则。 */
function checkSemantics(m: Manifest): void {
  const bad = (why: string): never => fail('manifest', 'PKG_INVALID_MANIFEST', why);
  const paths = m.files.map((f) => f.path);
  for (let k = 1; k < paths.length; k++) {
    if (compareUtf8(paths[k - 1]!, paths[k]!) >= 0) bad('files[] 不是按 UTF-8 字节严格升序（含重复）');
  }
  if (new Set(paths.map((p) => p.toLowerCase())).size !== paths.length) bad('files[] 有大小写不敏感的重复');
  const fns = m.policy.entries.map((x) => x.function);
  if (new Set(fns).size !== fns.length) bad('入口函数重复');
  for (const x of m.policy.entries) {
    const ptr = `#/$defs/entry.${x.function}`;
    if (x.inputSchema !== ptr || x.outputSchema !== ptr) bad(`入口 ${x.function} 的 schema 指针不是 ${ptr}`);
    if (x.function !== x.function.normalize('NFC')) bad(`函数名不是 NFC：${x.function}`);
  }
  if (m.policy.moduleName !== m.policy.moduleName.normalize('NFC')) bad('模块名不是 NFC');
  // 1.1：display 存在 ⇒ files[] 同时含两个显示文件（display 不存在时它们只是普通载荷）
  if (m.display !== undefined && !DISPLAY_FILES.every((p) => paths.includes(p))) bad('display 存在但 files[] 缺显示排版文件');
}

/** manifest 阶段全部检查；通过返回 manifest。 */
export function checkManifest(bytes: Uint8Array): Manifest {
  const tree = parseCanonicalManifest(bytes);
  if (!isJsonObject(tree)) return fail('manifest', 'PKG_INVALID_MANIFEST', '顶层不是对象');
  if (tree['format'] !== PACKAGE_FORMAT) fail('manifest', 'PKG_INVALID_MANIFEST', 'format 不是 aster-policy-package');
  const fvRaw = tree['formatVersion'];
  const fv = typeof fvRaw === 'string' ? FORMAT_VERSION.exec(fvRaw) : null;
  if (!fv) return fail('manifest', 'PKG_INVALID_MANIFEST', 'formatVersion 语法不合法');
  const minor = Number(fv[2]);
  if (Number(fv[1]) !== 1 || minor > MAX_MINOR) fail('manifest', 'PKG_UNSUPPORTED_FORMAT', `formatVersion ${String(fvRaw)}`);
  if (!validateManifestSchema(tree, minor)) {
    const errors = (minor === 1 ? manifestValidator11 : manifestValidator)?.errors ?? [];
    fail('manifest', 'PKG_INVALID_MANIFEST', `schema：${JSON.stringify(errors).slice(0, 500)}`);
  }
  const m = tree as unknown as Manifest;
  checkSemantics(m);
  if (m.coreIr.version !== 2) fail('manifest', 'PKG_UNSUPPORTED_IR', `coreIr.version ${m.coreIr.version}`);
  return m;
}

/** manifest 中 `default:true` 的入口（schema 保证恰好一个）。 */
export function defaultEntry(m: Manifest): string {
  return m.policy.entries.find((e) => e.default)!.function;
}
