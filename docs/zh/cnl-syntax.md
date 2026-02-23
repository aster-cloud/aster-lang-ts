# CNL 语法（当前风格）

本指南记录本仓库使用的当前 CNL 风格。示例以推断为主，不使用显式类型标注。

## 关键要点

- 每行一条语句，句尾以句号结束。
- 块头以冒号结束，并使用 2 空格缩进。
- 优先选择简单、可读的结构，避免深层嵌套表达式。

## 模块

```
Module greeting.
```

## 数据类型与枚举

```
Define User has name, age, email.

Define Status as one of Pending or Approved or Rejected.
```

## 构造与字段访问

```
Rule email_domain given user, produce:
  Return Text.after(user.email, "@").
```

## 函数

```
Rule greet given name, produce:
  Return Text.concat("Hello, ", name).
```

```
Rule is_empty given text, produce:
  Return Text.equals(text, "").
```

## 变量

```
Rule badge given user, produce:
  Let label be Text.concat("User ", user.name).
  Return label.
```

## 控制流

```
Rule check_access given role, produce:
  If role equals to "admin":
    Return true.
  Otherwise:
    Return false.
```

```
Rule eligibility given score, produce:
  If score at least 700:
    Return "approved".
  Otherwise:
    Return "review".
```

## 匹配

```
Rule explain given result, produce:
  Match result:
    When Ok(value), Return Text.concat("OK: ", value).
    When Err(error), Return Text.concat("ERR: ", error).
```

## 工作流（effects）

```
Rule sync_report, produce. It performs io:
  workflow:
    step fetch:
      Return Http.get("https://example.com/report").
    step store:
      Return Storage.write("report.txt", fetch).
```

## 注释

使用 `//` 添加行内或独立注释。注释可出现在块头之后或语句末尾。

```
Rule greet given name, produce: // header note
  Return Text.concat("Hi, ", name). // inline note
```

## 运算符与比较

常见比较与运算符以自然语言形式表达：

```
Let total be a plus b.
Let same be a equals to b.
Let older be age at least 21.
```

## 格式规则

- 语句以句号结尾。
- 块头以冒号结尾。
- 使用 2 空格缩进。
- 优先推断风格（示例中不写显式类型）。
- 不使用运算符链式调用；改用标准调用或中缀运算符。
