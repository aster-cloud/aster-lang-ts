# 中文 CNL 示例

本目录包含使用简体中文词法表 (zh-CN) 编写的 Aster CNL 示例程序。

## 文件列表

| 文件 | 描述 | 覆盖特性 |
|------|------|----------|
| `hello.aster` | Hello World 示例 | 模块声明、函数定义、字符串操作 |
| `loan_decision.aster` | 贷款决策 | 类型定义、条件判断、构造器 |
| `user_greeting.aster` | 用户问候 | 模式匹配、可选类型 |
| `arithmetic.aster` | 算术运算 | 加减乘除、变量绑定 |

## 语法要点

### 标点符号
- 语句结尾：`。`（中文句号）
- 块开始：`：`（中文冒号）
- 列表分隔：`，`（中文逗号）
- 字符串引号：`「」`（直角引号）
- 标记符号：`【】`（方括号）

### 关键词对照
| 中文 | 英文 |
|------|------|
| 模块 | Module |
| 定义 | Define |
| 包含 | has |
| 给定 | given |
| 产出 | produce |
| 返回 | Return |
| 若 | If |
| 否则 | Otherwise |
| 把...当 | Match...When |

## 运行测试

```bash
npm run test:unit -- --test-name-pattern "中文 CNL"
```
