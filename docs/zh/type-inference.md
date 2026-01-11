# 类型推断

当前 CNL 风格以类型推断为默认策略。参数、字段与返回值由使用方式推断，而不是显式声明。

## 推断内容

- 函数参数根据其使用方式推断。
- 数据字段根据构造与访问方式推断。
- 返回值类型根据 `Return` 表达式推断。

## 推断边界

当使用清晰且一致时，推断最可靠：

- `If` 的各分支应返回同一类型的值。
- `Match` 的各分支应返回兼容的值。
- 使用 `Let` 绑定可以让中间值更明确。

## 简单示例

```
Define User with id, name.

To get_name with user, produce:
  Return user.name.
```

```
To is_adult with age, produce:
  If age at least 18:
    Return true.
  Return false.
```

## 引导推断

当推断出现歧义时，建议：

- 新增一个小的辅助函数，使返回值用途清晰。
- 使用更具语义的命名（如 `count`、`has_`、`is_`、`message`）。
- 将复杂表达式拆分为多个 `Let` 绑定。
- 保持 `If` 和 `Match` 的返回类型一致。

## 避免显式类型标注

本仓库的示例与测试刻意避免显式类型标注。如果需要更清晰地表达类型，请使用结构化用法来体现。

## 实用重构模式

```
To score_label with score, produce:
  Let high be score at least 90.
  If high:
    Return "high".
  Otherwise:
    Return "standard".
```

```
To display_name with user, produce:
  Let name be user.name.
  Return Text.concat("User ", name).
```
