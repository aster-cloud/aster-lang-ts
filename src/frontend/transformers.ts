/**
 * 语法变换器（Syntax Transformers）
 *
 * 将自然语言风格的表达式转换为规范化的 CNL 语法。
 * 对应 Java 端 aster-lang-core 的 SyntaxTransformer 体系。
 *
 * 变换器分两个阶段执行：
 * - preTranslationTransformers: 关键字翻译前（处理源语言特有的语法糖）
 * - postTranslationTransformers: 关键字翻译后（处理规范化形式的语法糖）
 */

/** 变换器接口：接收源代码行，返回变换后的行 */
export interface SyntaxTransformer {
  readonly name: string;
  transform(source: string): string;
}

// ============================================================
// 内置变换器实现
// ============================================================

/**
 * 英语所有格变换器：`driver's age` → `driver.age`
 *
 * 将英语所有格语法转换为成员访问语法，
 * 使 "The driver's name" 等自然语言表达可被解析为字段访问。
 */
/**
 * ★左锚 `(?<![\p{L}0-9_])` 是 **ReDoS 修复**，不是可选优化。
 *
 * <p>没有它时，`[\p{L}][\p{L}0-9_]*` 可以从标识符**中间**任意位置起跑：引擎在
 * 每个字符位置都重新贪婪吃完整个标识符，再因为后面不是 `'s` 而全部回退，
 * 呈二次增长。实测（未加锚）：10000→160ms、20000→639ms、40000→2552ms，
 * 每翻倍恰好 ×4。
 *
 * <p>攻击载荷就是**一行看起来很普通的源码**：一长串字母后跟一个不闭合的
 * `'s`。本变换器跑在**用户提交的源文本**上，属攻击者可控输入。
 *
 * <h2>★左锚里**只能**排除 `\p{L}`，不能连 `0-9_` 一起排</h2>
 *
 * 我第一版写的是 `(?<![\p{L}0-9_])`，看着更"严密"，实际是**错的**：
 * 模式首字符是 `[\p{L}]`——**不含**数字与下划线。所以 `_x's y` 在旧模式下
 * 是从 `x` 起跑的合法匹配（得 `_x.y`），而多排了 `_` 的左锚会把它整个挡掉。
 *
 * <p>左锚的正确宽度 = 「该模式**首字符**能取的字符集」，多一个字符都是误伤。
 *
 * <p>实证：用偏向 `'s ` 的片段生成器随机 300000 组（其中 16715 组确有替换）：
 * ```
 *   (?<!\p{L})        分歧 0      ✓ 保语义
 *   (?<![\p{L}0-9_])  分歧 1895   ✖ 误伤
 * ```
 * ★这个错误是**等价性检查抓出来的**，人工样本（前 10 组）全绿。
 */
const POSSESSIVE_RE = /(?<!\p{L})([\p{L}][\p{L}0-9_]*)'s\s+([\p{L}][\p{L}0-9_]*)/gu;

const englishPossessive: SyntaxTransformer = {
  name: 'english-possessive',
  transform(source: string): string {
    return source.replace(POSSESSIVE_RE, '$1.$2');
  },
};

/**
 * Set-To 变换器：`Set x to expr` → `Let x be expr`
 *
 * 将命令式赋值语法转换为声明式绑定语法。
 */
/**
 * ★缩进捕获组用 `[ \t]*` 而非 `\s*`，这是 **ReDoS 修复**。
 *
 * `\s` 包含 `\n`，在 `m`（multiline）标志下 `^` 会在**每一个**行首匹配，
 * 而 `(\s*)` 又能一路吃穿后续所有空行——于是每个行首都要向后扫描整份剩余
 * 文本，呈二次增长。实测（n 个空行）：10000→165ms、20000→657ms、
 * 40000→2594ms，每翻倍 ×4。攻击载荷是一份**全是空行**的源文件。
 *
 * ★改用「水平空白」不改变语义，反而更准确：这个捕获组的用途是**保留该行的
 * 缩进**（替换串里的 `$1`），缩进按定义只由空格与制表符构成，跨行吃掉换行
 * 本来就是错的。实证：随机 200000 组（95956 组确有替换）逐字节零分歧。
 *
 * ★必须与 Java 侧 `SetToTransformer.SET_TO` 逐字一致——两引擎 canonicalize
 * 输出要字节相同（tier1-parity 门禁）。
 */
const SET_TO_RE = /^([ \t]*)Set\s+([\p{L}][\p{L}0-9_]*)\s+to\s+/gmu;

const setTo: SyntaxTransformer = {
  name: 'set-to',
  transform(source: string): string {
    SET_TO_RE.lastIndex = 0;
    return source.replace(SET_TO_RE, '$1Let $2 be ');
  },
};

/**
 * Result-Is 变换器：`The result is expr` → `Return expr`
 *
 * 将描述式返回语法转换为规范的 Return 语句。
 * 注意：必须在冠词移除之前执行，否则 "The" 会被先移除。
 */
/**
 * ★缩进捕获组用 `[ \t]*` 而非 `\s*`，理由同 {@link SET_TO_RE}：
 * multiline 下 `^(\s*)` 会在每个行首起跑并吃穿所有后续空行，呈二次增长。
 * 缩进按定义只含空格与制表符。须与 Java 侧
 * `ResultIsTransformer.RESULT_IS_LINE_START` 逐字一致。
 */
const RESULT_IS_RE = /^([ \t]*)The result is\s+/gmu;

const resultIs: SyntaxTransformer = {
  name: 'result-is',
  transform(source: string): string {
    RESULT_IS_RE.lastIndex = 0;
    return source.replace(RESULT_IS_RE, '$1Return ');
  },
};

// ============================================================
// 变换器注册表
// ============================================================

const registry = new Map<string, SyntaxTransformer>();
registry.set('english-possessive', englishPossessive);
registry.set('set-to', setTo);
registry.set('result-is', resultIs);

/**
 * 根据名称获取变换器。
 */
export function getTransformer(name: string): SyntaxTransformer | undefined {
  return registry.get(name);
}

/**
 * 注册自定义变换器（供语言包扩展使用）。
 */
export function registerTransformer(transformer: SyntaxTransformer): void {
  registry.set(transformer.name, transformer);
}

/**
 * 按名称列表依次应用变换器到源代码。
 */
export function applyTransformers(source: string, names: readonly string[]): string {
  let result = source;
  for (const name of names) {
    const t = registry.get(name);
    if (t) {
      result = t.transform(result);
    }
  }
  return result;
}
