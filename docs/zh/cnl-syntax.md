# CNL 语法（当前风格）

本指南记录本仓库使用的当前 CNL 风格。示例以推断为主，不使用显式类型标注。

## 关键要点

- 每行一条语句，句尾以句号结束。
- 块头以冒号结束，并使用 2 空格缩进。
- 优先选择简单、可读的结构，避免深层嵌套表达式。

## 模块

```
This module is greeting.
```

## 数据类型与枚举

```
Define User with name, age, email.

Define Status as one of Pending or Approved or Rejected.
```

## 构造与字段访问

```
To email_domain with user, produce:
  Return Text.after(user.email, "@").
```

## 函数

```
To greet with name, produce:
  Return Text.concat("Hello, ", name).
```

```
To is_empty with text, produce:
  Return Text.equals(text, "").
```

## 变量

```
To badge with user, produce:
  Let label be Text.concat("User ", user.name).
  Return label.
```

## 控制流

```
To check_access with role, produce:
  If role equals to "admin":
    Return true.
  Otherwise:
    Return false.
```

```
To eligibility with score, produce:
  If score at least 700:
    Return "approved".
  Otherwise:
    Return "review".
```

## 匹配

```
To explain with result, produce:
  Match result:
    When Ok(value), Return Text.concat("OK: ", value).
    When Err(error), Return Text.concat("ERR: ", error).
```

## 工作流（effects）

```
To sync_report, produce. It performs io:
  workflow:
    step fetch:
      Return Http.get("https://example.com/report").
    step store:
      Return Storage.write("report.txt", fetch).
```

## 注释

使用 `//` 添加行内或独立注释。注释可出现在块头之后或语句末尾。

```
To greet with name, produce: // header note
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
