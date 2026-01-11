import type { Diagnostic } from 'vscode-languageserver/node.js';
import { DiagnosticSeverity } from 'vscode-languageserver/node.js';
import { TokenKind, type Core } from '../types.js';
import { checkPiiFlow } from './pii_diagnostics.js';

export function findAmbiguousInteropCalls(tokens: readonly any[]): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]?.kind === TokenKind.IDENT || tokens[i]?.kind === TokenKind.TYPE_IDENT) {
      let j = i;
      let dotted = false;
      while (
        tokens[j + 1]?.kind === TokenKind.DOT &&
        (tokens[j + 2]?.kind === TokenKind.IDENT || tokens[j + 2]?.kind === TokenKind.TYPE_IDENT)
      ) {
        dotted = true;
        j += 2;
      }
      if (dotted && tokens[j + 1]?.kind === TokenKind.LPAREN) {
        let k = j + 2;
        let depth = 1;
        let hasInt = false,
          hasLong = false,
          hasDouble = false;
        while (k < tokens.length && depth > 0) {
          const tk = tokens[k];
          if (tk.kind === TokenKind.LPAREN) depth++;
          else if (tk.kind === TokenKind.RPAREN) depth--;
          else if (tk.kind === TokenKind.INT) hasInt = true;
          else if (tk.kind === TokenKind.LONG) hasLong = true;
          else if (tk.kind === TokenKind.FLOAT) hasDouble = true;
          k++;
        }
        if (depth === 0 && ((hasInt ? 1 : 0) + (hasLong ? 1 : 0) + (hasDouble ? 1 : 0)) > 1) {
          const start = tokens[i].start;
          const end = tokens[k - 1]?.end ?? tokens[j + 1].end;
          diags.push({
            severity: DiagnosticSeverity.Warning,
            range: {
              start: { line: start.line - 1, character: start.col - 1 },
              end: { line: end.line - 1, character: end.col - 1 },
            },
            message:
              `Ambiguous interop call: mixed numeric arguments (int=${hasInt}, long=${hasLong}, double=${hasDouble}). Consider using 1L or 1.0 to disambiguate.`,
            source: 'aster-lsp',
          });
        }
        i = k;
      }
    }
  }
  return diags;
}

export function findDottedCallRangeAt(
  tokens: readonly any[],
  pos: { line: number; character: number }
): { start: { line: number; character: number }; end: { line: number; character: number } } | null {
  // Find a dotted call IDENT(.IDENT)+ followed by parentheses that covers the given 0-based position
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]?.kind === TokenKind.IDENT || tokens[i]?.kind === TokenKind.TYPE_IDENT) {
      let j = i;
      let dotted = false;
      while (
        tokens[j + 1]?.kind === TokenKind.DOT &&
        (tokens[j + 2]?.kind === TokenKind.IDENT || tokens[j + 2]?.kind === TokenKind.TYPE_IDENT)
      ) {
        dotted = true;
        j += 2;
      }
      if (dotted && tokens[j + 1]?.kind === TokenKind.LPAREN) {
        // find matching RPAREN
        let k = j + 2;
        let depth = 1;
        while (k < tokens.length && depth > 0) {
          const tk = tokens[k];
          if (tk.kind === TokenKind.LPAREN) depth++;
          else if (tk.kind === TokenKind.RPAREN) depth--;
          k++;
        }
        const start = tokens[i].start;
        const end = tokens[k - 1]?.end ?? tokens[j + 1].end;
        const covers =
          pos.line >= start.line - 1 &&
          pos.line <= end.line - 1 &&
          (pos.line > start.line - 1 || pos.character >= start.col - 1) &&
          (pos.line < end.line - 1 || pos.character <= end.col - 1);
        if (covers) {
          return {
            start: { line: start.line - 1, character: start.col - 1 },
            end: { line: end.line - 1, character: end.col - 1 },
          };
        }
        i = k; // skip
      }
    }
  }
  return null;
}

export function describeDottedCallAt(
  tokens: readonly any[],
  pos: { line: number; character: number }
): { name: string; argDescs: string[] } | null {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]?.kind === TokenKind.IDENT || tokens[i]?.kind === TokenKind.TYPE_IDENT) {
      let j = i;
      let dotted = false;
      const parts: string[] = [tokens[i].value];
      while (
        tokens[j + 1]?.kind === TokenKind.DOT &&
        (tokens[j + 2]?.kind === TokenKind.IDENT || tokens[j + 2]?.kind === TokenKind.TYPE_IDENT)
      ) {
        dotted = true;
        parts.push(tokens[j + 2].value);
        j += 2;
      }
      if (dotted && tokens[j + 1]?.kind === TokenKind.LPAREN) {
        let k = j + 2;
        let depth = 1;
        const kinds: string[] = [];
        while (k < tokens.length && depth > 0) {
          const tk = tokens[k];
          if (tk.kind === TokenKind.LPAREN) depth++;
          else if (tk.kind === TokenKind.RPAREN) depth--;
          else if (tk.kind === TokenKind.INT) kinds.push('I');
          else if (tk.kind === TokenKind.LONG) kinds.push('J');
          else if (tk.kind === TokenKind.FLOAT) kinds.push('D');
          else if (tk.kind === TokenKind.BOOL) kinds.push('Z');
          else if (tk.kind === TokenKind.STRING) kinds.push('Ljava/lang/String;');
          k++;
        }
        const start = tokens[i].start;
        const end = tokens[k - 1]?.end ?? tokens[j + 1].end;
        const covers =
          pos.line >= start.line - 1 &&
          pos.line <= end.line - 1 &&
          (pos.line > start.line - 1 || pos.character >= start.col - 1) &&
          (pos.line < end.line - 1 || pos.character <= end.col - 1);
        if (covers) {
          // Widen numeric kinds collectively: any D -> all numeric to D, else any J -> I->J
          const hasD = kinds.includes('D');
          const hasJ = kinds.includes('J');
          const finalKinds = kinds.map(kd => {
            if (kd === 'I') return hasD ? 'D' : hasJ ? 'J' : 'I';
            if (kd === 'J') return hasD ? 'D' : 'J';
            return kd;
          });
          return { name: parts.join('.'), argDescs: finalKinds };
        }
        i = k;
      }
    }
  }
  return null;
}

export function buildDescriptorPreview(name: string, argDescs: string[]): string | null {
  // Known classes: aster.runtime.Interop with methods pick and sum
  const owner = name.substring(0, name.lastIndexOf('.'));
  const method = name.substring(name.lastIndexOf('.') + 1);
  if (owner === 'aster.runtime.Interop') {
    if (method === 'sum') {
      // Expect two numeric args; choose based on presence of D/J
      const hasD = argDescs.includes('D');
      const hasJ = argDescs.includes('J');
      const prim = hasD ? 'D' : hasJ ? 'J' : 'I';
      return `(${prim}${prim})Ljava/lang/String;`;
    }
    if (method === 'pick') {
      const a = argDescs[0] ?? 'Ljava/lang/Object;';
      const k = a === 'I' || a === 'J' || a === 'D' || a === 'Z' || a === 'Ljava/lang/String;' ? a : 'Ljava/lang/Object;';
      return `(${k})Ljava/lang/String;`;
    }
  }
  if (owner === 'Text') {
    switch (method) {
      case 'concat':
        return '(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;';
      case 'contains':
        return '(Ljava/lang/String;Ljava/lang/CharSequence;)Z';
      case 'equals':
        return '(Ljava/lang/Object;Ljava/lang/Object;)Z';
      case 'toUpper':
        return '(Ljava/lang/String;)Ljava/lang/String;';
      case 'toLower':
        return '(Ljava/lang/String;)Ljava/lang/String;';
      case 'length':
        return '(Ljava/lang/String;)I';
      case 'indexOf':
        return '(Ljava/lang/String;Ljava/lang/String;)I';
      case 'startsWith':
        return '(Ljava/lang/String;Ljava/lang/String;)Z';
      case 'endsWith':
        return '(Ljava/lang/String;Ljava/lang/String;)Z';
      case 'replace':
        return '(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;';
      case 'split':
        return '(Ljava/lang/String;Ljava/lang/String;)Ljava/util/List;';
    }
  }
  if (owner === 'List' && method === 'get') {
    return '(Ljava/util/List;I)Ljava/lang/Object;';
  }
  if (owner === 'List' && method === 'length') {
    return '(Ljava/util/List;)I';
  }
  if (owner === 'List' && method === 'isEmpty') {
    return '(Ljava/util/List;)Z';
  }
  if (owner === 'Map' && method === 'get') {
    return '(Ljava/util/Map;Ljava/lang/Object;)Ljava/lang/Object;';
  }
  if (owner === 'Map' && method === 'containsKey') {
    return '(Ljava/util/Map;Ljava/lang/Object;)Z';
  }
  if (owner === 'Set' && method === 'contains') {
    return '(Ljava/util/Set;Ljava/lang/Object;)Z';
  }
  if (owner === 'Set' && method === 'add') {
    return '(Ljava/util/Set;Ljava/lang/Object;)Z';
  }
  if (owner === 'Set' && method === 'remove') {
    return '(Ljava/util/Set;Ljava/lang/Object;)Z';
  }
  return null;
}

export function returnTypeTextFromDesc(desc: string | null): string | null {
  if (!desc) return null;
  const ret = desc.substring(desc.lastIndexOf(')') + 1);
  switch (ret) {
    case 'V': return 'Unit';
    case 'I': return 'Int';
    case 'Z': return 'Bool';
    case 'J': return 'Long';
    case 'D': return 'Double';
    case 'Ljava/lang/String;': return 'Text';
  }
  if (ret.startsWith('Ljava/util/List;')) return 'List';
  if (ret.startsWith('Ljava/util/Map;')) return 'Map';
  if (ret.startsWith('Ljava/util/Set;')) return 'Set';
  if (ret.startsWith('L')) return 'Object';
  return 'Unknown';
}

// Nullability policy for known interop helpers: true means param is nullable
const NULL_POLICY: Record<string, boolean[]> = {
  'aster.runtime.Interop.pick': [true],
  'aster.runtime.Interop.sum': [false, false],
  'Text.concat': [false, false],
  'Text.contains': [false, false],
  'Text.equals': [true, true],
  'Text.toUpper': [false],
  'Text.toLower': [false],
  'Text.length': [false],
  'Text.indexOf': [false, false],
  'Text.startsWith': [false, false],
  'Text.endsWith': [false, false],
  'Text.replace': [false, false, false],
  'Text.split': [false, false],
  'List.length': [false],
  'List.isEmpty': [false],
  'List.get': [false, false],
  'Map.get': [false, true],
  'Map.containsKey': [false, true],
  'Set.contains': [false, true],
  'Set.add': [false, true],
  'Set.remove': [false, true],
};

export function findNullabilityDiagnostics(tokens: readonly any[]): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]?.kind === TokenKind.IDENT || tokens[i]?.kind === TokenKind.TYPE_IDENT) {
      // collect dotted owner.method
      let j = i;
      let dotted = false;
      const parts: string[] = [tokens[i].value];
      while (
        tokens[j + 1]?.kind === TokenKind.DOT &&
        (tokens[j + 2]?.kind === TokenKind.IDENT || tokens[j + 2]?.kind === TokenKind.TYPE_IDENT)
      ) {
        dotted = true;
        parts.push(tokens[j + 2].value);
        j += 2;
      }
      if (dotted && tokens[j + 1]?.kind === TokenKind.LPAREN) {
        const dottedName = parts.join('.');
        const policy = NULL_POLICY[dottedName];
        let k = j + 2;
        let depth = 1;
        let argIndex = 0;
        while (k < tokens.length && depth > 0) {
          const tk = tokens[k];
          if (tk.kind === TokenKind.LPAREN) depth++;
          else if (tk.kind === TokenKind.RPAREN) depth--;
          else if (depth === 1 && tk.kind === TokenKind.NULL) {
            if (policy && policy[argIndex] === false) {
              diags.push({
                severity: DiagnosticSeverity.Warning,
                range: {
                  start: { line: tk.start.line - 1, character: tk.start.col - 1 },
                  end: { line: tk.end.line - 1, character: tk.end.col - 1 },
                },
                message: `Nullability: parameter ${argIndex + 1} of '${dottedName}' is non-null, but null was provided`,
                source: 'aster-lsp',
              });
            }
            argIndex++;
          } else if (depth === 1 && tk.kind === TokenKind.COMMA) {
            // move to next param slot
          } else if (depth === 1 && (tk.kind === TokenKind.INT || tk.kind === TokenKind.LONG || tk.kind === TokenKind.FLOAT || tk.kind === TokenKind.STRING || tk.kind === TokenKind.BOOL || tk.kind === TokenKind.IDENT || tk.kind === TokenKind.TYPE_IDENT)) {
            // count an argument token start
            // crude: count once per arg; commas will be encountered too
            // increment only when previous was ')' or after '('
          }
          // increment argIndex on commas at depth 1
          if (depth === 1 && tk.kind === TokenKind.COMMA) argIndex++;
          k++;
        }
        i = k;
      }
    }
  }
  return diags;
}

export function collectSemanticDiagnostics(tokens: readonly any[], core: Core.Module): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  diagnostics.push(...findAmbiguousInteropCalls(tokens));
  diagnostics.push(...findNullabilityDiagnostics(tokens));
  // 集成 PII 流水线诊断，确保统一返回集合
  diagnostics.push(...checkPiiFlow(core));
  return diagnostics;
}

export function computeDisambiguationEdits(
  tokens: readonly any[],
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
): Array<{ range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }> {
  const edits: Array<{ range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }> = [];
  const startsBeforeOrAt = (tok: any): boolean =>
    tok.start.line - 1 >= range.start.line && tok.end.line - 1 <= range.end.line + 1;

  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (!startsBeforeOrAt(t)) {
      i++;
      continue;
    }
    if (t.kind === TokenKind.LPAREN) break;
    i++;
  }
  if (i >= tokens.length) return edits;
  let k = i + 1;
  let depth = 1;
  const argInts: any[] = [];
  const argLongs: any[] = [];
  const argDoubles: any[] = [];
  while (k < tokens.length && depth > 0) {
    const tk = tokens[k];
    if (tk.kind === TokenKind.LPAREN) depth++;
    else if (tk.kind === TokenKind.RPAREN) depth--;
    else if (tk.kind === TokenKind.INT) argInts.push(tk);
    else if (tk.kind === TokenKind.LONG) argLongs.push(tk);
    else if (tk.kind === TokenKind.FLOAT) argDoubles.push(tk);
    k++;
  }
  const hasD = argDoubles.length > 0;
  const hasJ = argLongs.length > 0;
  if (hasD) {
    for (const tk of argInts) edits.push(literalEditToDouble(tk));
    for (const tk of argLongs) edits.push(literalEditLongToDouble(tk));
  } else if (hasJ) {
    for (const tk of argInts) edits.push(literalEditToLong(tk));
  }
  return edits;
}

function toRange(tok: any): { start: { line: number; character: number }; end: { line: number; character: number } } {
  return {
    start: { line: tok.start.line - 1, character: tok.start.col - 1 },
    end: { line: tok.end.line - 1, character: tok.end.col - 1 },
  };
}
function literalEditToDouble(tok: any): { range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string } {
  return { range: toRange(tok), newText: String(tok.value) + '.0' };
}
function literalEditLongToDouble(tok: any): { range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string } {
  return { range: toRange(tok), newText: String(tok.value) + '.0' };
}
function literalEditToLong(tok: any): { range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string } {
  return { range: toRange(tok), newText: String(tok.value) + 'L' };
}
