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
const POSSESSIVE_RE = /([\p{L}][\p{L}0-9_]*)'s\s+([\p{L}][\p{L}0-9_]*)/gu;

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
const SET_TO_RE = /^(\s*)Set\s+([\p{L}][\p{L}0-9_]*)\s+to\s+/gmu;

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
const RESULT_IS_RE = /^(\s*)The result is\s+/gmu;

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
