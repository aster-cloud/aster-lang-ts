/**
 * 按 key（文档 uri）各自防抖的定时器表。
 *
 * 文档关闭时必须 cancel：onDidClose 已把该文档从 docCache 剔除，若防抖定时器
 * 仍然触发，回调里的 getOrParse 会为已关闭文档重新填充解析缓存，直到该文档
 * 再次打开才可能被替换——每次「改完立刻关」都留下一份幽灵缓存。
 */
export class DebounceMap {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** 为 key 安排一次延迟回调；同 key 上一次尚未触发的安排被替换。 */
  schedule(key: string, delayMs: number, fn: () => void | Promise<void>): void {
    this.cancel(key);
    const handle = setTimeout(() => {
      this.timers.delete(key);
      void fn();
    }, delayMs);
    this.timers.set(key, handle);
  }

  /** 撤销 key 上尚未触发的回调；返回是否确有撤销。 */
  cancel(key: string): boolean {
    const handle = this.timers.get(key);
    if (handle === undefined) return false;
    clearTimeout(handle);
    this.timers.delete(key);
    return true;
  }

  has(key: string): boolean {
    return this.timers.has(key);
  }
}
