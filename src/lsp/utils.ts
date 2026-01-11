import type { Span } from '../types.js';

export function buildIdIndex(tokens: readonly any[]): Map<string, Span[]> {
  const map = new Map<string, Span[]>();
  for (const t of tokens as any[]) {
    if (!t || !t.start || !t.end) continue;
    // 跳过 trivia Token（如注释）
    if (t.channel === 'trivia') continue;
    if (!(t.kind === 'IDENT' || t.kind === 'TYPE_IDENT')) continue;
    const name = String(t.value || '');
    if (!name) continue;
    const sp: Span = { start: { line: t.start.line, col: t.start.col }, end: { line: t.end.line, col: t.end.col } } as any;
    (map.get(name) ?? (map.set(name, []), map.get(name)!)).push(sp);
  }
  return map;
}

export function exprTypeText(e: any): string {
  if (!e) return '';
  switch (e.kind) {
    case 'String': return 'Text';
    case 'Int': return 'Int';
    case 'Long': return 'Long';
    case 'Double': return 'Double';
    case 'Bool': return 'Bool';
    case 'Null': return 'Unknown';
    case 'Name': return 'Unknown';
    case 'Construct': return e.typeName || 'Unknown';
    case 'Ok': return `Result<${exprTypeText(e.expr)}, Unknown>`;
    case 'Err': return `Result<Unknown, ${exprTypeText(e.expr)}>`;
    case 'Some': return `Option<${exprTypeText(e.expr)}>`;
    case 'Call': {
      if (e.target?.kind === 'Name') {
        const n = e.target.name as string;
        if (n === 'Text.concat') return 'Text';
        if (n === 'Text.length') return 'Int';
        if (n === '+') return 'Int';
        if (n === 'not' || n === '<' || n === '>' || n === '<=' || n === '>=' || n === '==') return 'Bool';
      }
      return 'Unknown';
    }
    default:
      return 'Unknown';
  }
}
