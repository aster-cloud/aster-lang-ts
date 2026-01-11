# 运算符链式调用移除

已移除运算符链式调用（例如 `Text.equals(a, b).equals(c, d)`）。请改用标准函数调用或中缀运算符。

## 为什么要改

- 表达更清晰、易读。
- 避免长链条降低可读性。
- 鼓励通过 `Let` 将步骤拆分并命名。

## 推荐写法

```
If Text.equals(a, b):
  Return true.
```

```
If a equals to b:
  Return true.
```

```
Let total be a plus b.
Return total.
```

```
Let same be a equals to b.
If same:
  Return true.
```

## 替代关系

- `Text.equals(a, b).equals(c, d)` -> `If Text.equals(a, b):` 再单独处理 `Text.equals(c, d)`。
- `List.head(xs).toString()` -> `Text.concat("", List.head(xs))` 或 `Int.toString(List.head(xs))`（选择合适的辅助函数）。
- `obj.getField()` -> `obj.field`（字段访问），或 `Type.method(obj, ...)`（辅助函数）。

## 迁移建议

- 使用 `Let` 绑定拆解嵌套表达式。
- 避免点式链式调用，使用嵌套调用或多条语句。
- 保持表达式短小可读，便于非程序员理解。

## 快速检查清单

- 将 `a.b().c()` 拆为多条语句或辅助函数调用。
- 更偏好 `Type.method(value, ...)` 而非 `value.method(...)`。
- 若结果会立即被复用，先用 `Let` 绑定。
