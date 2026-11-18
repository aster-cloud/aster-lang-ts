/**
 * ir 阶段：取得求值用的 Core IR（README「检查顺序」ir 行，ADR 0059 §4.2、修订 1 A2）。
 *
 *   - A 包：严格读入 `compiled/core.json`（`readCoreIr`），失败 `PKG_UNSUPPORTED_IR`，IR 原样使用；
 *   - B 包：按 manifest 的 locale / aliasSet / allowStructural / 词汇本地编译（含 aliasSet 校验），
 *     去掉 `origin.start.col` / `origin.end.col` 后的规范字节 SHA-256 必须等于 `coreIr.positionFreeSha256`，
 *     编译失败或不等都是 `PKG_IR_DRIFT`，绝不求值；没有绕过参数。
 * `coreIr.sha256` 仍是平台 IR 的精确字节哈希，进 `meta.coreIrSha256`；本地 IR 的哈希不进信封。
 */
import { readCoreIr } from '../core/read-core-ir.js';
import { CompileFailure, compileSource, decodeSourceText, parseAliasSetJson, parseVocabularyJson, positionFreeSha256 } from './compile-source.js';
import { fail } from './errors.js';
import type { LoadedPackage } from './read-package.js';
import { decodeUtf8Strict } from './strict-json.js';

// 源码编译与投影哈希在 Workers 安全的 compile-source.ts 中，这里原样再导出（既有 import 路径不变）。
export {
  CompileFailure,
  compileSource,
  decodeSourceText,
  isBlankSource,
  lexiconForLocale,
  parseAliasSetJson,
  parseVocabularyJson,
  positionFreeSha256,
  type CompileSourceOptions,
} from './compile-source.js';

/** 按 manifest 本地编译包内 `policy/`（B 包的 run、两种包的 `verify --recompile`、`compile <pkg>` 共用）。 */
export function compilePackageSource(pkg: LoadedPackage): string {
  const file = (p: string): Uint8Array | undefined => pkg.files.get(p);
  let source: string;
  try {
    source = decodeSourceText(file('policy/policy.aster')!);
  } catch {
    throw new CompileFailure(['policy/policy.aster 不是合法 UTF-8']);
  }
  const vocabBytes = file('policy/compile/vocabulary.json');
  return compileSource(source, {
    locale: pkg.manifest.source.locale,
    aliasSet: parseAliasSetJson(file('policy/compile/alias-set.json')!),
    allowStructural: pkg.manifest.source.allowStructural,
    vocabulary: vocabBytes ? parseVocabularyJson(vocabBytes) : undefined,
  });
}

/** 严格读入 A 包的 `compiled/core.json`；失败 `PKG_UNSUPPORTED_IR`。 */
export function readCompiledIr(pkg: LoadedPackage): string {
  const bytes = pkg.files.get('compiled/core.json')!;
  try {
    const text = decodeUtf8Strict(bytes);
    readCoreIr(text);
    return text;
  } catch (e) {
    return fail('ir', 'PKG_UNSUPPORTED_IR', `compiled/core.json 严格读入失败：${(e as Error).message}`);
  }
}

/** B 包本地编译并按投影哈希比对；失败 `PKG_IR_DRIFT`（诊断写进 detail，只进 stderr）。 */
export function recompileAndCompare(pkg: LoadedPackage): string {
  let coreJson: string;
  try {
    coreJson = compilePackageSource(pkg);
  } catch (e) {
    const diags = e instanceof CompileFailure ? e.diagnostics.join('\n') : String(e);
    return fail('ir', 'PKG_IR_DRIFT', `本地编译失败：\n${diags}`);
  }
  let local: string;
  try {
    local = positionFreeSha256(coreJson);
  } catch (e) {
    return fail('ir', 'PKG_IR_DRIFT', `本地 IR 无法投影：${(e as Error).message}`);
  }
  if (local !== pkg.manifest.coreIr.positionFreeSha256) {
    fail('ir', 'PKG_IR_DRIFT', `本地 IR 投影哈希 ${local} ≠ coreIr.positionFreeSha256 ${pkg.manifest.coreIr.positionFreeSha256}`);
  }
  return coreJson;
}

/** 取得求值用的 IR。 */
export function obtainIr(pkg: LoadedPackage): { coreJson: string; recompiled: boolean } {
  if (pkg.manifest.mode === 'a') return { coreJson: readCompiledIr(pkg), recompiled: false };
  return { coreJson: recompileAndCompare(pkg), recompiled: true };
}
