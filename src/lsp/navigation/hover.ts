/**
 * LSP Hover 处理器
 * 提供悬停提示信息
 */

import type { Connection } from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { typeText, formatAnnotations } from '../completion.js';
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

/**
 * 注册 Hover 处理器
 * @param connection LSP 连接对象
 * @param documents 文档管理器
 * @param getOrParse 文档解析函数
 */
export function registerHoverHandler(
  connection: Connection,
  documents: { get(uri: string): TextDocument | undefined },
  getOrParse: (doc: TextDocument) => { text: string; tokens: readonly any[]; ast: any }
): void {
  connection.onHover(async params => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const entry = getOrParse(doc);
    const { tokens: toks, ast } = entry;
    const pos = params.position;

    // Build token index once for O(log n) lookups
    const tokenIndex = buildTokenIndex(toks);

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
      const ast2 = (ast as AstModule) || (parse(toks) as AstModule);
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
            return { contents: { kind: 'markdown', value: `Pattern binding ${patInfo.name}${ofTxt}` } };
          }
          if (nameAt) {
            const param = f.params.find(p => p.name === nameAt);
            if (param) {
              const annots = formatAnnotations(param.annotations);
              const annotPrefix = annots ? `${annots} ` : '';
              // 检查是否是 PII 参数，添加合规提示
              const piiHint = buildPiiComplianceHint(param);
              const baseInfo = `Parameter ${annotPrefix}**${param.name}**: ${typeText(param.type)}`;
              return { contents: { kind: 'markdown', value: piiHint ? `${baseInfo}\n\n${piiHint}` : baseInfo } };
            }
            const localInfo = findLocalLetWithExpr(f.body as AstBlock | null, nameAt);
            if (localInfo) {
              const hint = exprTypeText(localInfo.expr);
              return { contents: { kind: 'markdown', value: `Local ${nameAt}${hint ? ': ' + hint : ''}` } };
            }
          }
          return { contents: { kind: 'markdown', value: `Function ${f.name} — ${funcDetail(f)}` } };
        }
        if (isAstData(decl)) {
          const d = decl;
          const fields = d.fields.map(f => {
            const annots = formatAnnotations(f.annotations);
            const annotPrefix = annots ? `${annots} ` : '';
            return `${annotPrefix}**${f.name}**: ${typeText(f.type)}`;
          }).join(', ');
          return { contents: { kind: 'markdown', value: `type ${d.name}${fields ? ' — ' + fields : ''}` } };
        }
        if (isAstEnum(decl)) {
          const e = decl;
          return { contents: { kind: 'markdown', value: `enum ${e.name} — ${e.variants.join(', ')}` } };
        }
      }
    } catch {
      // ignore
    }
    return null;
  });
}

/**
 * 为 PII 参数构建合规提示信息
 */
function buildPiiComplianceHint(param: { name: string; type: any; annotations?: readonly any[] | undefined }): string | null {
  // 检查是否有 @pii 注解
  const piiAnnot = param.annotations?.find(
    (a: any) => a.name?.toLowerCase() === 'pii' || a.kind === 'pii'
  );

  // 检查类型是否为 PII 类型
  const isPiiType = param.type?.kind === 'PiiType' ||
    param.type?.name?.toLowerCase()?.includes('pii');

  if (!piiAnnot && !isPiiType) return null;

  // 提取 PII 等级
  let level = 'L1';
  if (piiAnnot?.args?.level) {
    level = piiAnnot.args.level;
  } else if (param.type?.level) {
    level = param.type.level;
  }

  // 根据等级提供不同的合规提示
  const hints: string[] = [];
  hints.push(`⚠️ **PII Data** (Level: ${level})`);

  switch (level) {
    case 'L3':
      hints.push('- 🔴 High sensitivity: SSN, passport, biometric');
      hints.push('- GDPR: Requires explicit consent (Art. 9)');
      hints.push('- HIPAA: PHI - encryption required');
      hints.push('- Must use `redact()` before logging/transmission');
      break;
    case 'L2':
      hints.push('- 🟠 Medium sensitivity: email, phone, address');
      hints.push('- GDPR: Lawful basis required (Art. 6)');
      hints.push('- Consider encryption at rest');
      break;
    case 'L1':
    default:
      hints.push('- 🟡 Low sensitivity: name, preferences');
      hints.push('- GDPR: Document processing purpose');
      break;
  }

  hints.push('');
  hints.push('*Use `redact()` or `tokenize()` before external transmission*');

  return hints.join('\n');
}
