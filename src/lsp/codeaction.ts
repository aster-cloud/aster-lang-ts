/**
 * LSP CodeAction 模块
 * 提供代码动作和快速修复功能
 */

import type { Connection, CodeAction, CodeActionParams, Range } from 'vscode-languageserver/node.js';
import { CodeActionKind, TextEdit } from 'vscode-languageserver/node.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { computeDisambiguationEdits } from './analysis.js';
import { loadCapabilityManifest } from './diagnostics.js';
import { ConfigService } from '../config/config-service.js';
import { ErrorCode } from '../diagnostics/error_codes.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * 注册 CodeAction 相关的 LSP 处理器
 * @param connection LSP 连接对象
 * @param documents 文档管理器，提供 get 方法按 URI 获取文档
 * @param getOrParse 文档解析函数，返回文本、词法标记和 AST
 * @param uriToFsPath URI 转文件系统路径函数
 */
export function registerCodeActionHandlers(
  connection: Connection,
  documents: { get(uri: string): TextDocument | undefined },
  getOrParse: (doc: TextDocument) => { text: string; tokens: readonly any[]; ast: any },
  uriToFsPath: (u: string) => string | null
): void {
  // 第一个 CodeAction 处理器：能力声明和效果相关的 Quick Fix
  connection.onCodeAction(async (params: CodeActionParams): Promise<CodeAction[]> => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    const text = doc.getText();
    const actions: CodeAction[] = [];
    const capsPath = ConfigService.getInstance().capsManifestPath || '';

    for (const d of params.context.diagnostics) {
      const code = (d.code as string) || '';

      // 处理缺失的 IO/CPU 效果声明
      if (code === 'EFF_MISSING_IO' || code === 'EFF_MISSING_CPU') {
        const cap = code.endsWith('IO') ? 'IO' : 'CPU';
        const func = ((d as any).data?.func as string) || extractFuncNameFromMessage(d.message);
        const edit = headerInsertEffectEdit(text, func, cap);
        if (edit) actions.push({
          title: `Add It performs ${cap} to '${func}'`,
          kind: CodeActionKind.QuickFix,
          edit: { changes: { [params.textDocument.uri]: [edit] } },
          diagnostics: [d],
        });
      }

      // 处理多余的 IO/CPU 效果声明
      if (code === 'EFF_SUPERFLUOUS_IO' || code === 'EFF_SUPERFLUOUS_CPU') {
        const cap = code.endsWith('IO') ? 'IO' : 'CPU';
        const func = ((d as any).data?.func as string) || extractFuncNameFromMessage(d.message);
        const edit = headerRemoveEffectEdit(text, func);
        if (edit) actions.push({
          title: `Remove It performs ${cap} from '${func}'`,
          kind: CodeActionKind.QuickFix,
          edit: { changes: { [params.textDocument.uri]: [edit] } },
          diagnostics: [d],
        });
      }

      // 处理能力清单相关的 Quick Fix
      if (code === ErrorCode.CAPABILITY_NOT_ALLOWED && capsPath) {
        const capRaw = ((d as any).data?.cap as string) || '';
        // 将 CapabilityKind 转换为清单使用的小写键名
        const cap = capRaw.toLowerCase();
        const func = ((d as any).data?.func as string) || extractFuncNameFromMessage(d.message);
        const mod = ((d as any).data?.module as string) || extractModuleName(text) || '';
        const fqn = mod ? `${mod}.${func}` : func;

        try {
          const manifest = await loadCapabilityManifest();
          if (!manifest) continue;
          const man: any = manifest; // Cast to any for capability manipulation
          const uri = toFileUri(capsPath);

          // Offer: allow for specific function (ensure FQN)
          {
            const manFn = structuredClone(man);
            const textFn = ensureCapabilityAllow(manFn, cap, fqn);
            actions.push({
              title: `Allow ${cap.toUpperCase()} for ${fqn} in manifest`,
              kind: CodeActionKind.QuickFix,
              edit: { changes: { [uri]: [TextEdit.replace(fullDocRange(), textFn)] } },
              diagnostics: [d],
            });
          }

          // Offer: allow for entire module (module.*)
          if (mod) {
            const modWildcard = `${mod}.*`;
            const manMod = structuredClone(man);
            const textMod = ensureCapabilityAllow(manMod, cap, modWildcard);
            actions.push({
              title: `Allow ${cap.toUpperCase()} for ${mod}.* in manifest`,
              kind: CodeActionKind.QuickFix,
              edit: { changes: { [uri]: [TextEdit.replace(fullDocRange(), textMod)] } },
              diagnostics: [d],
            });

            // If module.* is already present, offer to narrow to function-only (remove module.*)
            const arr: string[] = Array.isArray(man.allow?.[cap]) ? man.allow[cap] : [];
            if (arr.includes(modWildcard)) {
              const manNarrow = structuredClone(man);
              const textNarrow = swapCapabilityAllow(manNarrow, cap, modWildcard, fqn);
              actions.push({
                title: `Narrow ${cap.toUpperCase()} from ${mod}.* to ${fqn}`,
                kind: CodeActionKind.QuickFix,
                edit: { changes: { [uri]: [TextEdit.replace(fullDocRange(), textNarrow)] } },
                diagnostics: [d],
              });
            }

            // If function is already present, offer to broaden to module.* (remove fqn)
            if (arr.includes(fqn)) {
              const manBroad = structuredClone(man);
              const textBroad = swapCapabilityAllow(manBroad, cap, fqn, modWildcard);
              actions.push({
                title: `Broaden ${cap.toUpperCase()} from ${fqn} to ${mod}.*`,
                kind: CodeActionKind.QuickFix,
                edit: { changes: { [uri]: [TextEdit.replace(fullDocRange(), textBroad)] } },
                diagnostics: [d],
              });
            }
          }
        } catch {
          // ignore
        }
      }

      // 处理效应变量未声明 (E210)
      if (code === ErrorCode.EFFECT_VAR_UNDECLARED) {
        const varName = ((d as any).data?.var as string) || '';
        const func = ((d as any).data?.func as string) || '';
        if (varName && func) {
          // 提供添加效应变量声明的Quick Fix
          const edit = addEffectVarToSignature(text, func, varName);
          if (edit) {
            actions.push({
              title: `Add effect variable '${varName}' to function '${func}'`,
              kind: CodeActionKind.QuickFix,
              edit: { changes: { [params.textDocument.uri]: [edit] } },
              diagnostics: [d],
            });
          }
        }
      }

      // 处理效应变量无法解析 (E211)
      if (code === ErrorCode.EFFECT_VAR_UNRESOLVED) {
        const vars = ((d as any).data?.vars as string) || '';
        const func = ((d as any).data?.func as string) || '';
        if (vars && func) {
          // 为每个可能的具体效应提供Quick Fix选项
          for (const concreteEffect of ['PURE', 'CPU', 'IO']) {
            actions.push({
              title: `Instantiate ${vars} as ${concreteEffect} in '${func}'`,
              kind: CodeActionKind.QuickFix,
              diagnostics: [d],
              // 注意：实际的edit生成较复杂，这里暂时只提供提示
              // 完整实现需要解析函数调用链并替换效应变量
            });
          }
        }
      }

      // 处理 Interop 数值重载歧义
      if (typeof d.message === 'string' && d.message.startsWith('Ambiguous interop call')) {
        // Advisory hint
        actions.push({
          title: 'Hint: Disambiguate numeric overload (use 1L or 1.0) — see Guide: JVM Interop Overloads',
          kind: 'quickfix' as any,
          diagnostics: [d],
        });

        // Compute concrete edits from current document content
        try {
          const { tokens: toks } = getOrParse(doc);
          const edits = computeDisambiguationEdits(toks, d.range);
          if (edits.length > 0) {
            actions.push({
              title: 'Fix: Make numeric literals unambiguous',
              kind: 'quickfix' as any,
              diagnostics: [d],
              edit: {
                changes: {
                  [params.textDocument.uri]: edits,
                },
              },
            });
          }
        } catch {
          // ignore
        }
      }

      // Quick fix for nullability: replace null with "" for Text.* calls
      if (typeof d.message === 'string' && d.message.startsWith('Nullability:')) {
        const m = d.message.match(/parameter\s+(\d+)\s+of\s+'([^']+)'/);
        const paramIdx = m ? Math.max(1, parseInt(m[1] || '1', 10)) : 1;
        const dotted = m ? m[2] || '' : '';
        const replacement = suggestNullReplacement(dotted, paramIdx);

        if (replacement !== 'null') {
          actions.push({
            title: `Fix: Replace null with ${replacement}`,
            kind: 'quickfix' as any,
            diagnostics: [d],
            edit: {
              changes: {
                [params.textDocument.uri]: [
                  {
                    range: d.range,
                    newText: replacement,
                  },
                ],
              },
            },
          });
        }
      }

      // Quick fix: add missing module header
      if (typeof d.message === 'string' && d.message.startsWith('Missing module header')) {
        const fsPath = uriToFsPath(doc.uri) || doc.uri;
        const mod = suggestModuleFromPath(fsPath);
        const header = `This module is ${mod}.\n`;
        actions.push({
          title: `Fix: Add module header (This module is ${mod}.)`,
          kind: 'quickfix' as any,
          diagnostics: [d],
          edit: { changes: { [params.textDocument.uri]: [TextEdit.insert({ line: 0, character: 0 }, header)] } },
        });
      }

      // Quick fix: add missing punctuation at end of line
      if (typeof d.message === 'string' && /Expected (':'|\.) at end of line/i.test(d.message)) {
        const rng = d.range;
        const isColon = /:/.test(d.message);
        const ch = isColon ? ':' : '.';
        actions.push({
          title: `Fix: add '${ch}' at end of line`,
          kind: 'quickfix' as any,
          diagnostics: [d],
          edit: { changes: { [params.textDocument.uri]: [TextEdit.insert(rng.end, ch)] } },
        });
      }

      // PII compliance Quick Fix: 为 PII sink 警告提供修复建议
      if (d.source === 'aster-pii') {
        const sinkKind = ((d as any).data?.sinkKind as string) || '';

        // HTTP 传输 PII：建议使用 HTTPS 或加密
        if (code === ErrorCode.PII_HTTP_UNENCRYPTED || sinkKind === 'http') {
          actions.push({
            title: 'Hint: Use HTTPS or encrypt PII before transmission',
            kind: CodeActionKind.QuickFix,
            diagnostics: [d],
          });
          // 提供 redact() 包装的 Quick Fix
          const lineText = text.split(/\r?\n/)[d.range.start.line] || '';
          const argMatch = lineText.match(/\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)/);
          if (argMatch && argMatch[1]) {
            const varName = argMatch[1];
            const varIndex = lineText.indexOf(varName);
            if (varIndex >= 0) {
              actions.push({
                title: `Fix: Wrap ${varName} with redact() before sending`,
                kind: CodeActionKind.QuickFix,
                diagnostics: [d],
                edit: {
                  changes: {
                    [params.textDocument.uri]: [
                      TextEdit.replace(
                        { start: { line: d.range.start.line, character: varIndex },
                          end: { line: d.range.start.line, character: varIndex + varName.length } },
                        `redact(${varName})`
                      ),
                    ],
                  },
                },
              });
            }
          }
        }

        // Console/Log PII：建议脱敏或移除
        if (sinkKind === 'console') {
          actions.push({
            title: 'Hint: Remove PII from logs or use redact()',
            kind: CodeActionKind.QuickFix,
            diagnostics: [d],
          });
        }

        // Database PII：建议加密存储
        if (sinkKind === 'database') {
          actions.push({
            title: 'Hint: Encrypt PII before database storage (GDPR Art. 32)',
            kind: CodeActionKind.QuickFix,
            diagnostics: [d],
          });
        }

        // File PII：建议访问控制
        if (sinkKind === 'file') {
          actions.push({
            title: 'Hint: Ensure file access control for PII data',
            kind: CodeActionKind.QuickFix,
            diagnostics: [d],
          });
        }

        // 缺失同意检查：提供添加注解的 Quick Fix
        if (code === ErrorCode.PII_MISSING_CONSENT_CHECK || (d as any).data?.missingConsent) {
          const funcName = ((d as any).data?.func as string) || '';
          actions.push({
            title: 'Hint: Add consent check before processing PII (GDPR Art. 6)',
            kind: CodeActionKind.QuickFix,
            diagnostics: [d],
          });

          // 提供添加 @consent_required 注解的 Quick Fix
          if (funcName) {
            const edit = addConsentAnnotation(text, funcName);
            if (edit) {
              actions.push({
                title: `Fix: Add @consent_required annotation to '${funcName}'`,
                kind: CodeActionKind.QuickFix,
                diagnostics: [d],
                edit: {
                  changes: {
                    [params.textDocument.uri]: [edit],
                  },
                },
              });
            }
          }
        }
      }
    }

    // Bulk numeric overload disambiguation for current selection (no diagnostic required)
    try {
      const { tokens: toks } = getOrParse(doc);
      const edits = computeDisambiguationEdits(toks, params.range as any);
      if (edits.length > 0) {
        actions.push({
          title: 'Fix: Disambiguate numeric overloads in selection',
          kind: 'quickfix' as any,
          edit: { changes: { [params.textDocument.uri]: edits } },
        });
      }
    } catch {
      // ignore
    }

    return actions;
  });
}

/**
 * 辅助函数：从诊断消息中提取函数名
 */
function extractFuncNameFromMessage(msg: string): string {
  const m = msg.match(/Function '([^']+)'/);
  return m?.[1] ?? '';
}

/**
 * 辅助函数：从文本中提取模块名
 */
function extractModuleName(text: string): string | null {
  const m = text.match(/This module is ([A-Za-z][A-Za-z0-9_.]*)\./);
  return m?.[1] ?? null;
}

/**
 * 辅助函数：在函数头部插入效果声明
 */
function headerInsertEffectEdit(text: string, func: string, cap: 'IO' | 'CPU'): TextEdit | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^To\s+/i.test(line) && new RegExp(`\\b${func}\\b`).test(line)) {
      if (/It performs/i.test(line)) return null;
      const withEff = line.replace(/(:|\.)\s*$/, `. It performs ${cap}:`);
      return TextEdit.replace({ start: { line: i, character: 0 }, end: { line: i, character: line.length } }, withEff);
    }
  }
  return null;
}

/**
 * 辅助函数：从函数头部移除效果声明
 */
function headerRemoveEffectEdit(text: string, func: string): TextEdit | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^To\s+/i.test(line) && new RegExp(`\\b${func}\\b`).test(line) && /It performs/i.test(line)) {
      const cleaned = line.replace(/\. It performs (IO|CPU):/i, ':');
      return TextEdit.replace({ start: { line: i, character: 0 }, end: { line: i, character: line.length } }, cleaned);
    }
  }
  return null;
}

/**
 * 辅助函数：为函数签名添加效应变量声明
 */
function addEffectVarToSignature(text: string, func: string, varName: string): TextEdit | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    // 查找函数签名：支持 CNL 和 formal 两种语法
    // CNL: "To funcName with params, produce Type:"
    // Formal: "fn funcName(params): RetType" 或 "fn funcName of T, E(params): RetType"

    if (/^To\s+/i.test(line) && new RegExp(`\\b${func}\\b`).test(line)) {
      // CNL 语法暂不支持效应变量，跳过
      return null;
    }

    if (/^fn\s+/i.test(line) && new RegExp(`\\b${func}\\b`).test(line)) {
      // Formal 语法: fn funcName of T, E(params): RetType
      // 检查是否已有 "of" 子句
      if (/\s+of\s+/.test(line)) {
        // 已有泛型参数，在现有列表中添加效应变量
        const updated = line.replace(/(\s+of\s+[^(]+)(\()/, `$1, ${varName}$2`);
        return TextEdit.replace(
          { start: { line: i, character: 0 }, end: { line: i, character: line.length } },
          updated
        );
      } else {
        // 没有泛型参数，在函数名后添加 "of E"
        const updated = line.replace(/(\s+)(\()/, ` of ${varName}$2`);
        return TextEdit.replace(
          { start: { line: i, character: 0 }, end: { line: i, character: line.length } },
          updated
        );
      }
    }
  }
  return null;
}

/**
 * 辅助函数：确保能力清单中包含指定项
 */
function ensureCapabilityAllow(man: any, cap: string, entry: string): string {
  const allow = (man.allow = man.allow || {});
  const arr: string[] = (allow[cap] = Array.isArray(allow[cap]) ? allow[cap] : []);
  if (!arr.includes(entry)) arr.push(entry);
  return JSON.stringify(man, null, 2) + '\n';
}

/**
 * 辅助函数：交换能力清单项
 */
function swapCapabilityAllow(man: any, cap: string, removeEntry: string, addEntry: string): string {
  const allow = (man.allow = man.allow || {});
  const arr: string[] = (allow[cap] = Array.isArray(allow[cap]) ? allow[cap] : []);
  const idx = arr.indexOf(removeEntry);
  if (idx >= 0) arr.splice(idx, 1);
  if (!arr.includes(addEntry)) arr.push(addEntry);
  return JSON.stringify(man, null, 2) + '\n';
}

/**
 * 辅助函数：文件路径转 file:// URI
 */
function toFileUri(p: string): string {
  const abs = path.isAbsolute(p) ? p : path.resolve(p);
  return String(pathToFileURL(abs));
}

/**
 * 辅助函数：返回全文档范围
 */
function fullDocRange(): Range {
  return { start: { line: 0, character: 0 }, end: { line: Number.MAX_SAFE_INTEGER, character: 0 } };
}

/**
 * 辅助函数：根据调用和参数索引建议 null 的替代值
 */
function suggestNullReplacement(dotted: string, paramIdx: number): string {
  // Text helpers
  if (dotted === 'Text.split') return paramIdx === 2 ? '" "' : '""'; // h, sep
  if (dotted === 'Text.startsWith') return '""'; // param 1 or 2
  if (dotted === 'Text.endsWith') return '""';   // param 1 or 2
  if (dotted === 'Text.indexOf') return paramIdx === 2 ? '" "' : '""'; // h, needle
  if (dotted === 'Text.contains') return '""';
  if (dotted === 'Text.replace') return '""';    // any of 1/2/3
  if (dotted === 'Text.toUpper' || dotted === 'Text.toLower' || dotted === 'Text.length') return '""';
  if (dotted === 'Text.concat') return '""';
  // Collections / Interop defaults
  if (dotted === 'List.get' && paramIdx === 2) return '0';
  if (dotted === 'Map.get' && paramIdx === 2) return '""';
  if (dotted === 'Map.containsKey' && paramIdx === 2) return '""';
  if (dotted === 'Set.contains' && paramIdx === 2) return '""';
  if (dotted === 'Set.add' && paramIdx === 2) return '""';
  if (dotted === 'Set.remove' && paramIdx === 2) return '""';
  if (dotted === 'aster.runtime.Interop.sum') return '0';
  if (dotted === 'aster.runtime.Interop.pick') return '""';
  // fallback for Text.*
  if (dotted.startsWith('Text.')) return '""';
  return 'null';
}

/**
 * 辅助函数：从文件路径推断模块名
 */
function suggestModuleFromPath(fsPath: string): string {
  try {
    const root = process.cwd();
    const rel = path.relative(root, fsPath);
    const noExt = rel.replace(/\.[^.]+$/, '');
    const parts = noExt.split(path.sep).filter(Boolean);
    // If under test/cnl/, drop leading segment
    if (parts[0] === 'cnl') parts.shift();
    return parts.join('.').replace(/[^A-Za-z0-9_.]/g, '_') || 'main';
  } catch {
    return 'main';
  }
}

/**
 * 辅助函数：为函数添加 @consent_required 注解
 */
function addConsentAnnotation(text: string, func: string): TextEdit | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    // 查找 CNL 语法: "To funcName ..."
    if (/^To\s+/i.test(line) && new RegExp(`\\b${func}\\b`).test(line)) {
      // 在函数定义前插入 @consent_required 注解
      const indent = line.match(/^(\s*)/)?.[1] || '';
      return TextEdit.insert(
        { line: i, character: 0 },
        `${indent}@consent_required\n`
      );
    }
    // 查找 formal 语法: "fn funcName ..." 或 "@... fn funcName ..."
    if (/^(\s*)(@\w+\s+)*fn\s+/i.test(line) && new RegExp(`\\b${func}\\b`).test(line)) {
      // 检查前一行是否已有注解
      const prevLine = i > 0 ? lines[i - 1] ?? '' : '';
      if (prevLine.trim().startsWith('@consent_required')) {
        return null; // 已有注解
      }
      const indent = line.match(/^(\s*)/)?.[1] || '';
      return TextEdit.insert(
        { line: i, character: 0 },
        `${indent}@consent_required\n`
      );
    }
  }
  return null;
}
