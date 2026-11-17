/**
 * `aster/canonicalPreview` 的请求名与响应形状（ADR 0058 §8.2）。
 *
 * 独立成无副作用、无 Node 依赖的模块，供 `./browser` 与 `./lsp` 入口再导出，
 * 让编辑器客户端不必深引用 server 实现即可拿到契约。
 * 偏移一律是 UTF-16 code unit（ADR §7.8）。
 */
export const CANONICAL_PREVIEW_METHOD = 'aster/canonicalPreview';

export interface CanonicalPreview {
  text: string;
  mappings: Array<{ source: [number, number]; preview: [number, number]; canonical: string; role: string }>;
  resolverVersion: number;
}
