/**
 * LSP Hover 处理器
 * 提供悬停提示信息
 */

import type { Connection } from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { typeText } from '../completion.js';
import {
  findDottedCallRangeAt,
  describeDottedCallAt,
  findAmbiguousInteropCalls,
  buildDescriptorPreview,
  returnTypeTextFromDesc,
} from '../analysis.js';
import { exprTypeText } from '../utils.js';
import { parse } from '../../parser.js';
import { buildTokenIndex, tokenNameAt as tokenNameAtOptimized } from '../token-index.js';
import {
  funcDetail,
  findDeclAt,
  findPatternBindingDetail,
  findLocalLetWithExpr,
} from './shared.js';
import {
  isAstFunc,
  isAstData,
  isAstEnum,
} from '../type-guards.js';
import type {
  Module as AstModule,
  Block as AstBlock,
} from '../../types.js';
import type { Lexicon } from '../../config/lexicons/types.js';
import { getLspUiTexts } from '../../config/lexicons/lsp-ui-texts.js';
import type { LspUiTexts } from '../../config/lexicons/lsp-ui-texts.js';
import { resolveDocument, siteAt } from '../resolution.js';
import type { ResolvableDocument, ResolutionSite } from '../resolution.js';
import type { ResolvedRole } from '../../types.js';

/** 悬停所需的文档快照：tokens / AST，以及名称解析用的语法诊断与租户词汇。 */
type HoverDocument = { text: string; tokens: readonly any[]; ast: any } & Omit<ResolvableDocument, 'ast'>;
type HoverResult = { contents: { kind: 'markdown'; value: string } };

function roleLabel(role: ResolvedRole, ui: Readonly<LspUiTexts>): string | undefined {
  switch (role) {
    case 'TYPE_DECL':
    case 'TYPE':
      return ui.resolutionRoleType;
    case 'FIELD_DECL':
    case 'FIELD_REF':
      return ui.resolutionRoleField;
    case 'MEMBER_DECL':
    case 'MEMBER_REF':
      return ui.resolutionRoleMember;
    case 'FUNC_DECL':
    case 'FUNC_REF':
      return ui.resolutionRoleFunction;
    default:
      return undefined;
  }
}

/** `写法 → 规范名（角色 · 父名）`；写法等于规范名或角色为局部名时不显示。 */
export function formatResolution(site: ResolutionSite, ui: Readonly<LspUiTexts>): string | null {
  const label = roleLabel(site.role, ui);
  if (!label || site.written === site.canonical) return null;
  const detail = site.parent ? `${label} · ${site.parent}` : label;
  return `${site.written} → ${site.canonical}${ui.resolutionOpen}${detail}${ui.resolutionClose}`;
}

/** 光标处名字的解析行；语法不完整时只有 R1 位置（R2 已跳过）。 */
function resolutionLineAt(entry: HoverDocument, pos: { line: number; character: number }, word: string | null, ui: Readonly<LspUiTexts>): string | null {
  if (!word) return null;
  const site = siteAt(resolveDocument(entry), pos, word);
  return site ? formatResolution(site, ui) : null;
}

/** 解析行置于原有悬停内容之前；二者皆无时不悬停。 */
function withResolutionLine(base: HoverResult | null, line: string | null): HoverResult | null {
  if (!line) return base;
  const value = base ? `${line}\n\n${base.contents.value}` : line;
  return { contents: { kind: 'markdown', value } };
}

/**
 * 注册 Hover 处理器
 * @param connection LSP 连接对象
 * @param documents 文档管理器
 * @param getOrParse 文档解析函数
 */
export function registerHoverHandler(
  connection: Connection,
  documents: { get(uri: string): TextDocument | undefined },
  getOrParse: (doc: TextDocument) => HoverDocument,
  getLexiconForDoc?: (uri: string) => Lexicon | undefined,
): void {
  connection.onHover(async params => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const entry = getOrParse(doc);
    const tokenIndex = buildTokenIndex(entry.tokens);
    const ui = getLspUiTexts(getLexiconForDoc?.(params.textDocument.uri));
    const base = baseHover(entry, tokenIndex, params.position, params.textDocument.uri, getLexiconForDoc);
    const line = resolutionLineAt(entry, params.position, tokenNameAtOptimized(tokenIndex, params.position), ui);
    return withResolutionLine(base, line);
  });
}

/** 原有悬停：互操作调用、声明 / 参数 / 局部名 / 模式绑定。 */
function baseHover(
  entry: HoverDocument,
  tokenIndex: ReturnType<typeof buildTokenIndex>,
  pos: { line: number; character: number },
  uri: string,
  getLexiconForDoc?: (uri: string) => Lexicon | undefined,
): HoverResult | null {
  const { tokens: toks, ast } = entry;

  const anyCall = findDottedCallRangeAt(toks, pos);
  if (anyCall) {
    // Include a short signature preview by heuristic
    const info = describeDottedCallAt(toks, pos);
    const sig = info ? `${info.name}(${info.argDescs.join(', ')})` : 'interop(...)';
    const diags = findAmbiguousInteropCalls(toks);
    const amb = diags.find(
      d =>
        d.range.start.line <= pos.line &&
        d.range.end.line >= pos.line &&
        d.range.start.character <= pos.character &&
        d.range.end.character >= pos.character
    );
    const header = amb ? 'Ambiguous interop call' : 'Interop call';
    const body = amb
      ? 'Use `1L` or `1.0` to disambiguate; a Quick Fix is available.'
      : 'Overload selection uses primitive widening/boxing; use `1L` or `1.0` to make intent explicit.';
    const desc = info ? buildDescriptorPreview(info.name, info.argDescs) : null;
    const retText = returnTypeTextFromDesc(desc);
    const extra = desc ? `\nDescriptor: \`${desc}\`` : '';
    const retLine = retText ? `\nReturns: **${retText}**` : '';
    const msg = `**${header}** — [Guide → JVM Interop Overloads](/guide/interop-overloads)\n\nPreview: \`${sig}\`${extra}${retLine}\n\n${body}`;
    return { contents: { kind: 'markdown', value: msg } };
  }
  // Semantic hover: decls/params/locals/types using AST spans and tokens
  try {
    const lexicon = getLexiconForDoc?.(uri);
    const ui = getLspUiTexts(lexicon);
    const ast2 = (ast as AstModule) || (parse(toks).ast as AstModule);
    const describeDecl = (d: unknown): string | null => {
      if (isAstFunc(d)) return `${ui.functionLabel} ${d.name} — ${funcDetail(d)}`;
      if (isAstData(d)) {
        const fields = d.fields.map(f => `**${f.name}**: ${typeText(f.type)}`).join(', ');
        return `${ui.typeLabel} ${d.name}${fields ? ' — ' + fields : ''}`;
      }
      if (isAstEnum(d)) return `${ui.enumLabel} ${d.name} — ${d.variants.join(', ')}`;
      return null;
    };
    /* ★光标上的名字若是顶层函数/类型/枚举，描述**那个**声明——与跳转定义同一套解析。
     *   旧实现只查参数/局部/模式绑定，其余一律落到外层函数：`Return twice(twice(x)).`
     *   里两个 twice 都显示「函数 quad」。 */
    const topLevelByName = (name: string | null): unknown => {
      if (!name) return undefined;
      return (ast2.decls as unknown[]).find(d => (isAstFunc(d) || isAstData(d) || isAstEnum(d)) && (d as { name: string }).name === name);
    };
    const decl = findDeclAt(ast2, pos);
    if (decl) {
      if (isAstFunc(decl)) {
        const f = decl;
        // Use optimized O(log n) token lookup
        const nameAt = tokenNameAtOptimized(tokenIndex, pos);
        // Pattern bindings: if hover is inside a case body and name matches a binding
        const patInfo = nameAt ? findPatternBindingDetail(f, nameAt, pos) : null;
        if (patInfo) {
          const ofTxt = patInfo.ofType ? ` of ${patInfo.ofType}` : '';
          return { contents: { kind: 'markdown', value: `${ui.patternBindingLabel} ${patInfo.name}${ofTxt}` } };
        }
        if (nameAt) {
          const param = f.params.find(p => p.name === nameAt);
          if (param) {
            const piiHint = buildPiiComplianceHint(param, lexicon);
            const baseInfo = `${ui.parameterLabel} **${param.name}**: ${typeText(param.type)}`;
            return { contents: { kind: 'markdown', value: piiHint ? `${baseInfo}\n\n${piiHint}` : baseInfo } };
          }
          const localInfo = findLocalLetWithExpr(f.body as AstBlock | null, nameAt);
          if (localInfo) {
            const hint = exprTypeText(localInfo.expr);
            return { contents: { kind: 'markdown', value: `${ui.localLabel} ${nameAt}${hint ? ': ' + hint : ''}` } };
          }
          const named = topLevelByName(nameAt);
          const namedText = named ? describeDecl(named) : null;
          if (namedText) return { contents: { kind: 'markdown', value: namedText } };
        }
        return { contents: { kind: 'markdown', value: `${ui.functionLabel} ${f.name} — ${funcDetail(f)}` } };
      }
      if (isAstData(decl)) {
        const d = decl;
        const fields = d.fields.map(f => `**${f.name}**: ${typeText(f.type)}`).join(', ');
        return { contents: { kind: 'markdown', value: `${ui.typeLabel} ${d.name}${fields ? ' — ' + fields : ''}` } };
      }
      if (isAstEnum(decl)) {
        const e = decl;
        return { contents: { kind: 'markdown', value: `${ui.enumLabel} ${e.name} — ${e.variants.join(', ')}` } };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * 为 PII 参数构建合规提示信息
 */
function buildPiiComplianceHint(param: { name: string; type: any }, lexicon?: Lexicon): string | null {
  // 检查类型是否为 PII 类型
  const isPiiType = param.type?.kind === 'PiiType' ||
    param.type?.name?.toLowerCase()?.includes('pii');

  if (!isPiiType) return null;

  // 提取 PII 等级
  let level = 'L1';
  if (param.type?.level) {
    level = param.type.level;
  }

  const ui = getLspUiTexts(lexicon);

  // 根据等级提供不同的合规提示
  const hints: string[] = [];
  hints.push(`⚠️ **${ui.piiWarningHeader}** (Level: ${level})`);

  switch (level) {
    case 'L3':
      hints.push(`- ${ui.piiL3Hint.split('\n').join('\n- ')}`);
      hints.push('- Must use `redact()` before logging/transmission');
      break;
    case 'L2':
      hints.push(`- ${ui.piiL2Hint.split('\n').join('\n- ')}`);
      break;
    case 'L1':
    default:
      hints.push(`- ${ui.piiL1Hint.split('\n').join('\n- ')}`);
      break;
  }

  hints.push('');
  hints.push(`*${ui.piiRedactHint}*`);

  return hints.join('\n');
}
