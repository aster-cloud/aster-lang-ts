/**
 * 源码数值字面量 → 规范十进制串（ADR 0055 §5），用于 `Double.value` 与 `Range.min/max`。
 *
 * 规则：无指数、无前导零、无尾随零，小数部分全零时省略小数点，`-0` 归一为 `"0"`。
 * 结果满足 schema `$defs/CanonicalDecimal` 的 pattern。值取自字面量**原文**，经 decimal.js
 * 任意精度十进制求出，不经二进制浮点：`123456789012345678901.5` 原样保留，经 double 则会变成
 * `123456789012345680000`。与 Java 侧 `BigDecimal.stripTrailingZeros().toPlainString()` 对应。
 */
import Decimal from 'decimal.js';

/** 把字面量原文（可带符号与指数，如 `-0.0`、`1e-7`、`1E3`）转成规范十进制串。 */
export function canonicalDecimalFromLiteral(raw: string): string {
  const value = new Decimal(raw);
  if (!value.isFinite()) {
    throw new RangeError(`数值字面量不是有限值：${raw}`);
  }
  // decimal.js 的 toFixed() 不带参数时按普通记数法输出全部有效位且不舍入，已去尾随零。
  return value.isZero() ? '0' : value.toFixed();
}
