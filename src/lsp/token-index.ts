/**
 * Token Index - 基于二分查找的位置索引
 * 将 O(n) 的线性查找优化为 O(log n) 的二分查找
 */

import type { Token, Span } from '../types.js';

/**
 * Token 位置索引结构
 */
export interface TokenIndex {
  /** 原始 token 数组 */
  tokens: readonly Token[];
  /** 按位置排序的索引数组，用于二分查找 */
  positions: Array<{ line: number; col: number; tokenIndex: number }>;
}

/**
 * 构建 token 位置索引
 * @param tokens Token 数组
 * @returns Token 索引结构
 */
export function buildTokenIndex(tokens: readonly Token[]): TokenIndex {
  const positions = tokens
    .map((t, i) => {
      if (!t || !t.start) return null;
      return {
        line: t.start.line,
        col: t.start.col,
        tokenIndex: i,
      };
    })
    .filter((p): p is { line: number; col: number; tokenIndex: number } => p !== null)
    .sort((a, b) => {
      // 按行优先，列次优先排序
      if (a.line !== b.line) return a.line - b.line;
      return a.col - b.col;
    });

  return { tokens, positions };
}

/**
 * 判断 LSP Position 是否在 Span 范围内
 * @param span Token Span（1-based 行列）
 * @param pos LSP Position（0-based 行列）
 * @returns 是否在范围内
 */
function within(span: { start: { line: number; col: number }; end: { line: number; col: number } }, pos: { line: number; character: number }): boolean {
  const l = pos.line + 1; // Convert to 1-based
  const c = pos.character + 1;
  const s = span.start;
  const e = span.end;

  if (l < s.line || l > e.line) return false;
  if (l === s.line && c < s.col) return false;
  return !(l === e.line && c > e.col);
}

/**
 * 使用二分查找在指定位置查找 token
 * @param index Token 索引
 * @param pos LSP Position（0-based）
 * @returns 匹配的 token，未找到则返回 null
 */
export function findTokenAt(
  index: TokenIndex,
  pos: { line: number; character: number }
): Token | null {
  const { tokens, positions } = index;

  if (positions.length === 0) return null;

  // 转换为 1-based 用于比较
  const targetLine = pos.line + 1;
  const targetCol = pos.character + 1;

  // 二分查找最接近的 token
  let left = 0;
  let right = positions.length - 1;
  let bestMatch: number | null = null;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const p = positions[mid]!;

    if (p.line < targetLine || (p.line === targetLine && p.col <= targetCol)) {
      // 当前位置可能是候选，继续向右查找
      bestMatch = mid;
      left = mid + 1;
    } else {
      // 当前位置太靠后，向左查找
      right = mid - 1;
    }
  }

  // 从 bestMatch 开始向后检查，找到包含目标位置的 token
  if (bestMatch !== null) {
    for (let i = bestMatch; i < positions.length && i <= bestMatch + 10; i++) {
      const idx = positions[i]!.tokenIndex;
      const t = tokens[idx];
      if (!t || !t.start || !t.end) continue;

      const span: Span = {
        start: { line: t.start.line, col: t.start.col },
        end: { line: t.end.line, col: t.end.col },
      };

      if (within(span, pos)) {
        return t;
      }

      // 如果已经超过目标位置，提前退出
      if (t.start.line > targetLine || (t.start.line === targetLine && t.start.col > targetCol)) {
        break;
      }
    }
  }

  return null;
}

/**
 * 获取指定位置处的标记名称（优化版本）
 * @param index Token 索引
 * @param pos LSP Position
 * @returns 标记名称（标识符或类型标识符），如果未找到则返回 null
 */
export function tokenNameAt(
  index: TokenIndex,
  pos: { line: number; character: number }
): string | null {
  const token = findTokenAt(index, pos);
  if (!token) return null;

  if (token.kind === 'IDENT' || token.kind === 'TYPE_IDENT') {
    return String(token.value || '');
  }

  return null;
}
