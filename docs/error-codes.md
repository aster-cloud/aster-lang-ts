# Aster 语言错误码参考

本文档列出了 Aster 语言编译器和类型检查器使用的所有错误码。

**总计**: 125 个错误码

## 按类别分类

### 异步编程 (async)

共 5 个错误码

| 错误码 | 严重性 | 消息模板 | 解决方案 |
|--------|--------|----------|----------|
| **E500** `ASYNC_START_NOT_WAITED` | 🔴 error | Started async task '&#123;task&#125;' not waited | Call wait on started async tasks to ensure completion. |
| **E501** `ASYNC_WAIT_NOT_STARTED` | 🔴 error | Waiting for async task '&#123;task&#125;' that was never started | Ensure the task name in wait matches a started task. |
| **E502** `ASYNC_DUPLICATE_START` | 🔴 error | Async task '&#123;task&#125;' started multiple times (&#123;count&#125; occurrences) | Avoid starting the same task multiple times; reuse or rename. |
| **E503** `ASYNC_DUPLICATE_WAIT` | 🟡 warning | Async task '&#123;task&#125;' waited multiple times (&#123;count&#125; occurrences) | Ensure each task is waited on only once, or use a separate synchronization mechanism. |
| **E504** `ASYNC_WAIT_BEFORE_START` | 🔴 error | Wait for async task '&#123;task&#125;' occurs before any matching start | Execute start before wait, and ensure both are on compatible control paths. |

### 能力系统 (capability)

共 7 个错误码

| 错误码 | 严重性 | 消息模板 | 解决方案 |
|--------|--------|----------|----------|
| **E027** `WORKFLOW_UNDECLARED_CAPABILITY` | 🔴 error | Workflow '&#123;func&#125;' step '&#123;step&#125;' uses capability &#123;capability&#125; that is not declared on the function header. | Declare &#123;capability&#125; in the function header or adjust the step code. |
| **E028** `COMPENSATE_NEW_CAPABILITY` | 🔴 error | Compensate block for step '&#123;step&#125;' in function '&#123;func&#125;' introduces new capability &#123;capability&#125; that does not appear in the main step body. | Compensate blocks can only reuse capabilities from the main step body. |
| **E300** `CAPABILITY_NOT_ALLOWED` | 🔴 error | Function '&#123;func&#125;' requires &#123;cap&#125; capability but manifest for module '&#123;module&#125;' denies it. | Update the capability manifest or modify the function to comply. |
| **E301** `EFF_CAP_MISSING` | 🔴 error | Function '&#123;func&#125;' uses &#123;cap&#125; capability but header declares [&#123;declared&#125;]. | Declare the actually used capabilities in the function header. |
| **E302** `EFF_CAP_SUPERFLUOUS` | 🔵 info | Function '&#123;func&#125;' declares &#123;cap&#125; capability but it is not used. | Remove unused capability declarations for clarity. |
| **E303** `CAPABILITY_INFER_MISSING_IO` | 🔴 error | Function '&#123;func&#125;' uses IO capabilities [&#123;capabilities&#125;] but is missing @io effect (e.g., &#123;calls&#125;). | Declare @io effect in the function header, or remove related calls to stay pure. |
| **E304** `CAPABILITY_INFER_MISSING_CPU` | 🔴 error | Function '&#123;func&#125;' performs CPU capability calls (e.g., &#123;calls&#125;) but declares neither @cpu nor @io effect. | Add @cpu or @io effect to cover CPU capabilities. |

### 效果系统 (effect)

共 13 个错误码

| 错误码 | 严重性 | 消息模板 | 解决方案 |
|--------|--------|----------|----------|
| **E023** `WORKFLOW_COMPENSATE_MISSING` | 🟡 warning | Step '&#123;step&#125;' performs side effects but does not define a compensate block. | Provide a compensate block for steps with IO side effects to enable rollback. |
| **E026** `WORKFLOW_MISSING_IO_EFFECT` | 🔴 error | Workflow '&#123;func&#125;' must declare @io effect before using a 'workflow' block. | Add @io effect declaration to the function header. |
| **E200** `EFF_MISSING_IO` | 🔴 error | Function '&#123;func&#125;' may perform I/O but is missing @io effect. | Declare @io effect for functions that perform I/O. |
| **E201** `EFF_MISSING_CPU` | 🔴 error | Function '&#123;func&#125;' may perform CPU-bound work but is missing @cpu (or @io) effect. | Declare @cpu or @io effect for CPU-intensive functions. |
| **E202** `EFF_SUPERFLUOUS_IO_CPU_ONLY` | 🔵 info | Function '&#123;func&#125;' declares @io but only CPU-like work found; @io subsumes @cpu and may be unnecessary. | If the function only does CPU work, consider removing the redundant @io declaration. |
| **E203** `EFF_SUPERFLUOUS_IO` | 🟡 warning | Function '&#123;func&#125;' declares @io but no obvious I/O found. | Confirm @io is needed; remove if no I/O behavior exists. |
| **E204** `EFF_SUPERFLUOUS_CPU` | 🟡 warning | Function '&#123;func&#125;' declares @cpu but no obvious CPU-bound work found. | Remove the redundant @cpu declaration or add corresponding CPU work. |
| **E205** `EFF_INFER_MISSING_IO` | 🔴 error | Function '&#123;func&#125;' missing @io effect declaration, inference requires IO. | Add @io effect based on inference results. |
| **E206** `EFF_INFER_MISSING_CPU` | 🔴 error | Function '&#123;func&#125;' missing @cpu effect declaration, inference requires CPU (or @io). | Add @cpu or @io effect based on inference results. |
| **E207** `EFF_INFER_REDUNDANT_IO` | 🟡 warning | Function '&#123;func&#125;' declares @io but no IO side effects inferred. | Confirm whether to keep the @io declaration. |
| **E208** `EFF_INFER_REDUNDANT_CPU` | 🟡 warning | Function '&#123;func&#125;' declares @cpu but no CPU side effects inferred. | Remove the @cpu declaration if no CPU side effects exist. |
| **E209** `EFF_INFER_REDUNDANT_CPU_WITH_IO` | 🟡 warning | Function '&#123;func&#125;' declares both @cpu and @io; @cpu is redundant since @io is required. | Keep @io only; remove the redundant @cpu. |
| **E212** `EFF_INFER_UNKNOWN_BUILTIN` | 🟡 warning | Effect of builtin '&#123;builtin&#125;' called by '&#123;func&#125;' is unknown; it is NOT assumed pure | Declare it via ASTER_EFFECT_CONFIG prefixes, supply an imported effect signature, or use a known stdlib namespace. |

### governance (governance)

共 14 个错误码

| 错误码 | 严重性 | 消息模板 | 解决方案 |
|--------|--------|----------|----------|
| **E701** `GOV_DUPLICATE_RULE_ID` | 🔴 error | Duplicate rule @id '&#123;id&#125;' on rules: &#123;rules&#125; | Rule ids must be unique within a module. Give each rule its own @id. |
| **E702** `GOV_ANNOTATION_ARG_INVALID` | 🔴 error | Annotation @&#123;annotation&#125; on rule '&#123;rule&#125;' expects exactly one string literal argument | Write @id("RULE-001"), @reason("...") or @control("EU_AI_ACT:ART14"). |
| **E703** `GOV_VERDICT_CALL_ARITY` | 🔴 error | &#123;func&#125; expects &#123;expected&#125; argument(s), got &#123;actual&#125; | Verdict.allow() takes no arguments; Verdict.deny(reason) and Verdict.escalate(reason) take one Text; Verdict.require_approval(role, reason) takes two Text. |
| **E705** `GOV_PROFILE_UNKNOWN` | 🔴 error | Module '&#123;module&#125;' declares unknown profile '&#123;profile&#125;' (controls registry &#123;version&#125;) | Use a profile defined in aster-lang-locales controls/registry.json, such as governed or eu-ai-act-high-risk. |
| **E706** `GOV_PROFILE_VIOLATION` | 🔴 error | Rule '&#123;rule&#125;' violates profile '&#123;profile&#125;': &#123;requirement&#125; | Satisfy the profile requirement or remove the Profile declaration. |
| **E707** `GOV_CHECK_UNAVAILABLE` | 🔴 error | Governance check could not run for module '&#123;module&#125;' (profile '&#123;profile&#125;'); saving is blocked until it succeeds | Retry later; this is a service fault, not a policy violation. |
| **E708** `GOV_PROFILE_INPUT_UNRESOLVABLE` | 🔴 error | Rule '&#123;rule&#125;' reads inputs that cannot be resolved statically (&#123;construct&#125;); profile '&#123;profile&#125;' requires verified inputs | Read input fields by literal path (for example req.context.amount), or move the dynamic access out of this rule, so its input references are known at compile time. |
| **E720** `CEDAR_NOT_EXPORTABLE_SHAPE` | 🔴 error | Rule '&#123;rule&#125;' cannot be exported to Cedar: &#123;reason&#125; | Exportable rules need @id, one parameter with the guard request fields (principal_id, principal_type, principal_roles, action, resource_type, resource_id, context, agent_model) and a Verdict result. |
| **E721** `CEDAR_UNSUPPORTED_CONSTRUCT` | 🔴 error | Rule '&#123;rule&#125;' uses &#123;construct&#125;, which has no Cedar translation | Use comparisons, and/or/not, List.contains on principal_roles and integer arithmetic with literals, or keep this rule Aster-only. |
| **E722** `CEDAR_UNTYPED_CONTEXT_KEY` | 🔴 error | Context key '&#123;key&#125;' in rule '&#123;rule&#125;' is used as both &#123;first&#125; and &#123;second&#125; | Use each context key with a single type (number, text or boolean). |
| **E723** `CEDAR_EQUIVALENCE_MISMATCH` | 🔴 error | Cedar export of rule '&#123;rule&#125;' disagrees with Aster on probe &#123;probe&#125;: Aster &#123;aster&#125;, Cedar &#123;cedar&#125; | This is an exporter defect; the export was withheld. Please report it. |
| **E724** `CEDAR_SCHEMA_INVALID` | 🔴 error | Generated Cedar for rule '&#123;rule&#125;' failed schema validation: &#123;detail&#125; | This is an exporter defect; the export was withheld. Please report it. |
| **W700** `GOV_VERDICT_RULE_MISSING_ID` | 🟡 warning | Rule '&#123;rule&#125;' returns Verdict but has no @id annotation | Add @id("RULE-001") so every decision can be traced to a stable rule identity. |
| **W704** `GOV_CONTROL_UNREGISTERED` | 🟡 warning | Control '&#123;control&#125;' on rule '&#123;rule&#125;' is not registered (controls registry &#123;version&#125;) | Use a registered key such as EU_AI_ACT:ART14, or add it to aster-lang-locales controls/registry.json (format FRAMEWORK:ARTICLE, at most 64 characters). |

### 降级（AST → Core IR） (lowering)

共 7 个错误码

| 错误码 | 严重性 | 消息模板 | 解决方案 |
|--------|--------|----------|----------|
| **E600** `LOWER_UNKNOWN_DECL_KIND` | 🔴 error | Unknown declaration kind: &#123;kind&#125; | The lowering stage received a declaration node it does not recognize. This is an engine defect, not a problem with the policy; report it together with the source. |
| **E601** `LOWER_UNKNOWN_EFFECT` | 🔴 error | Unknown effect '&#123;effect&#125;', valid values: &#123;valid&#125; | Declare only the supported effects (io, cpu) or an effect variable declared on the rule. |
| **E602** `LOWER_UNKNOWN_STMT_KIND` | 🔴 error | lowerStmt: unhandled statement kind '&#123;kind&#125;' | The lowering stage received a statement node it does not recognize. This is an engine defect, not a problem with the policy; report it together with the source. |
| **E603** `LOWER_UNKNOWN_EXPR_KIND` | 🔴 error | Unknown expression kind: &#123;kind&#125; | The lowering stage received an expression node it does not recognize. This is an engine defect, not a problem with the policy; report it together with the source. |
| **E604** `LOWER_UNKNOWN_PATTERN_KIND` | 🔴 error | Unknown pattern kind: &#123;kind&#125; | The lowering stage received a pattern node it does not recognize. This is an engine defect, not a problem with the policy; report it together with the source. |
| **E605** `LOWER_UNKNOWN_TYPE_KIND` | 🔴 error | Unknown type kind: &#123;kind&#125; | The lowering stage received a type node it does not recognize. This is an engine defect, not a problem with the policy; report it together with the source. |
| **E606** `LOWER_INTERNAL_ERROR` | 🔴 error | Internal error during lowering: &#123;detail&#125; | The compiler failed while lowering the policy to Core IR. This is an engine defect, not a problem with the policy; report it together with the source. |

### PII 隐私保护 (pii)

共 10 个错误码

| 错误码 | 严重性 | 消息模板 | 解决方案 |
|--------|--------|----------|----------|
| **E070** `PII_ASSIGN_DOWNGRADE` | 🔴 error | Cannot assign PII data to lower-level target: &#123;source&#125; -&gt; &#123;target&#125; | Use a sanitization function or declare a matching @pii level on the target. |
| **E072** `PII_SINK_UNSANITIZED` | 🔴 error | PII level &#123;level&#125; data output to &#123;sinkKind&#125; without sanitization | Call redact() or tokenize() before output to reduce sensitivity. |
| **E073** `PII_ARG_VIOLATION` | 🔴 error | PII argument type mismatch: expected &#123;expected&#125;, got &#123;actual&#125; | Check the function signature to ensure PII levels and categories match. |
| **E400** `PII_HTTP_UNENCRYPTED` | 🔴 error | PII data transmitted over HTTP without encryption | Use an encrypted channel (HTTPS) or sanitize before transmitting PII data. |
| **E401** `PII_ANNOTATION_MISSING` | 🔴 error | PII annotation missing for value flowing into '&#123;sink&#125;' | Add @pii annotation to sensitive data for tracking. |
| **E402** `PII_SENSITIVITY_MISMATCH` | 🟡 warning | PII sensitivity mismatch: required &#123;required&#125;, got &#123;actual&#125; | Adjust the data sensitivity level or update the process requirements. |
| **E403** `PII_MISSING_CONSENT_CHECK` | 🟡 warning | Function '&#123;func&#125;' processes PII data without consent check (GDPR Art. 6) | Call checkConsent() or add @consent_required annotation before processing PII data. |
| **E404** `PII_ANALYZER_FAILED` | 🔴 error | PII safety analysis failed for this module — the editor cannot verify whether sensitive data is correctly handled. This policy should not be deployed until the analysis succeeds. Internal reason: &#123;reason&#125; | Try saving and reloading the file. If the error persists, contact your administrator or report this issue with the source code attached. |
| **W071** `PII_IMPLICIT_UPLEVEL` | 🟡 warning | Implicit PII level escalation detected: &#123;source&#125; -&gt; &#123;target&#125; | Add explicit type annotations for level changes to aid auditing. |
| **W074** `PII_SINK_UNKNOWN` | 🟡 warning | PII data may flow to &#123;sinkKind&#125; without annotation | Add @pii annotation to track sensitive data flow. |

### 作用域与导入 (scope)

共 16 个错误码

| 错误码 | 严重性 | 消息模板 | 解决方案 |
|--------|--------|----------|----------|
| **E029** `WORKFLOW_UNKNOWN_STEP_DEPENDENCY` | 🔴 error | Workflow step '&#123;step&#125;' depends on undefined step '&#123;dependency&#125;'. | Only reference declared step names in the current workflow. |
| **E100** `DUPLICATE_IMPORT_ALIAS` | 🟡 warning | Duplicate import alias '&#123;alias&#125;'. | Use unique aliases for different imports to avoid shadowing. |
| **E101** `UNDEFINED_VARIABLE` | 🔴 error | Undefined variable: &#123;name&#125; | Declare and initialize the variable before use. |
| **E102** `MULTIPLE_ENTRY_RULES` | 🔴 error | Multiple @entry rules in module: &#123;rules&#125; | Keep at most one Rule annotated with @entry in a module. |
| **E103** `IMPORT_SYMBOL_CONFLICT` | 🟡 warning | Import symbol conflict: &#123;symbol&#125; | Adjust the import alias or the local top-level declaration name to avoid the import symbol conflict. |
| **E104** `DUPLICATE_SYMBOL` | 🔴 error | Symbol '&#123;name&#125;' is already defined in this scope. | Choose a different name or check for unintended duplicate declarations. |
| **E800** `UNRESOLVED_TYPE` | 🔴 error | Cannot resolve type '&#123;written&#125;' in &#123;role&#125; position | Check the spelling, import the type, or use a name from the active vocabulary. |
| **E801** `UNRESOLVED_FIELD` | 🔴 error | Cannot resolve field '&#123;written&#125;' in &#123;role&#125; position | Check the field name against the data type declaration or the active vocabulary. |
| **E802** `UNRESOLVED_NAME` | 🔴 error | Cannot resolve name '&#123;written&#125;' in &#123;role&#125; position | Declare the name, import it, use a name from the active vocabulary, or write a qualified enum member (e.g. Stufe.Hoch). |
| **E803** `UNRESOLVED_PATTERN` | 🔴 error | Cannot resolve pattern '&#123;written&#125;' in &#123;role&#125; position | Check that the pattern names an existing constructor or enum case of the scrutinee type. |
| **E804** `AMBIGUOUS_NAME` | 🔴 error | Name '&#123;written&#125;' in &#123;role&#125; position is ambiguous between: &#123;candidates&#125; | Write a qualified name (e.g. Stufe.Hoch) or add a type annotation. |
| **E805** `AMBIGUOUS_FIELD` | 🔴 error | Field '&#123;written&#125;' in &#123;role&#125; position is ambiguous between: &#123;candidates&#125; | Add a type annotation to the receiver (parameter or Let) so the field resolves against its declared type, or rename one of the conflicting fields. |
| **E806** `AMBIGUOUS_PATTERN` | 🔴 error | Pattern '&#123;written&#125;' in &#123;role&#125; position is ambiguous between: &#123;candidates&#125; | Write a qualified name (e.g. Stufe.Hoch) or add a type annotation. |
| **E807** `DUPLICATE_DECLARATION` | 🔴 error | Duplicate declaration of '&#123;written&#125;' in &#123;role&#125; position | Rename one of the declarations or remove the duplicate. |
| **W800** `SHADOWED_VOCABULARY` | 🟡 warning | Declaration '&#123;written&#125;' in &#123;role&#125; position shadows a vocabulary entry | Rename the declaration if the shadowing is unintended; the declaration wins over the vocabulary entry. |
| **W801** `RESOLVED_WITHOUT_TYPE` | 🟡 warning | Resolved '&#123;written&#125;' in &#123;role&#125; position without a known receiver type | Add a type annotation to the receiver so the name can be checked against its type. |

### 语法 (syntax)

共 21 个错误码

| 错误码 | 严重性 | 消息模板 | 解决方案 |
|--------|--------|----------|----------|
| **E050** `PARSE_UNEXPECTED_CHARACTER` | 🔴 error | Unrecognized character &#123;char&#125; | Remove the character or replace it with valid Aster syntax. |
| **E051** `PARSE_UNTERMINATED_STRING` | 🔴 error | Unterminated string literal | Close the string with a matching quote on the same line. |
| **E052** `PARSE_INDENTATION` | 🔴 error | Incorrect indentation: one level too deep or inconsistent. Indent with 2 spaces | Indent each nested block by exactly 2 spaces and dedent back to an enclosing level. |
| **E053** `PARSE_LITERAL_OUT_OF_RANGE` | 🔴 error | &#123;kind&#125; literal &#123;literal&#125; is out of range | Use a smaller value, add the 'L' suffix for Long, or write a Decimal literal. |
| **E054** `PARSE_NESTING_TOO_DEEP` | 🔴 error | Nesting is too deep (limit &#123;limit&#125;) | Split the expression or statement into smaller named parts. |
| **E055** `PARSE_EXPECTED` | 🔴 error | Expected &#123;token&#125; | Insert the expected token at this position. |
| **E056** `PARSE_EXPECTED_AFTER` | 🔴 error | Expected &#123;token&#125; after &#123;after&#125; | Insert the expected token after the preceding construct. |
| **E057** `PARSE_EXPECTED_IN` | 🔴 error | Expected &#123;token&#125; in &#123;context&#125; | Complete the construct with the expected token. |
| **E058** `PARSE_EXPECTED_AFTER_IN` | 🔴 error | Expected &#123;token&#125; after &#123;after&#125; in &#123;context&#125; | Insert the expected token after the preceding part of the construct. |
| **E059** `PARSE_EXPECTED_STATEMENT_END` | 🔴 error | Expected &#123;token&#125; at end of statement | End the statement with the statement terminator. |
| **E060** `PARSE_EXPECTED_BEFORE` | 🔴 error | Expected &#123;token&#125; before &#123;before&#125; | Insert the expected token before the highlighted token. |
| **E061** `PARSE_UNEXPECTED_TOKEN` | 🔴 error | Unexpected &#123;token&#125; | Remove the token or check the surrounding syntax. |
| **E062** `PARSE_UNEXPECTED_EXPECTING` | 🔴 error | Unexpected &#123;token&#125;; expected &#123;expected&#125; | Replace the token with one of the expected tokens. |
| **E063** `PARSE_NO_VIABLE` | 🔴 error | Cannot parse the syntax near &#123;token&#125; | Check the spelling of keywords and operators near this position. |
| **E064** `PARSE_UNEXPECTED_CONSTRUCT` | 🔴 error | Unexpected &#123;construct&#125; | Check that the line starts with a valid declaration, statement or expression. |
| **E065** `PARSE_MISPLACED` | 🔴 error | &#123;construct&#125; must appear &#123;position&#125; | Move the construct to the required position. |
| **E066** `PARSE_EMPTY_BLOCK` | 🔴 error | &#123;block&#125; must contain at least one &#123;item&#125; | Add the missing item to the block. |
| **E067** `PARSE_INVALID_VALUE` | 🔴 error | Invalid &#123;construct&#125; &#123;value&#125;; expected &#123;allowed&#125; | Use one of the allowed values. |
| **E068** `PARSE_CALL_ARITY` | 🔴 error | &#123;callee&#125; takes exactly &#123;expected&#125; argument(s), got &#123;actual&#125; | Pass exactly the required number of arguments. |
| **E069** `PARSE_UNKNOWN_NAME` | 🔴 error | Unknown &#123;kind&#125; &#123;name&#125; | Check the spelling against the supported names. |
| **E900** `PARSE_DUPLICATE_ANNOTATION_ARG` | 🔴 error | Annotation @&#123;annotation&#125; repeats the argument &#123;name&#125; | Give each named argument of an annotation at most once. |

### 类型系统 (type)

共 32 个错误码

| 错误码 | 严重性 | 消息模板 | 解决方案 |
|--------|--------|----------|----------|
| **E001** `TYPE_MISMATCH` | 🔴 error | Type mismatch: expected &#123;expected&#125;, got &#123;actual&#125; | Check that the type annotation matches the inferred expression type. |
| **E002** `TYPE_MISMATCH_ASSIGN` | 🔴 error | Type mismatch assigning to '&#123;name&#125;': &#123;expected&#125; vs &#123;actual&#125; | Ensure the variable's previous binding type matches the current assignment. |
| **E003** `RETURN_TYPE_MISMATCH` | 🔴 error | Return type mismatch: expected &#123;expected&#125;, got &#123;actual&#125; | Check that the return statement matches the declared return type. |
| **E004** `TYPE_VAR_UNDECLARED` | 🔴 error | Type variable '&#123;name&#125;' is used in '&#123;func&#125;' but not declared in its type parameters. | Declare used type variables in the function signature's 'of' clause. |
| **E005** `TYPE_PARAM_UNUSED` | 🟡 warning | Type parameter '&#123;name&#125;' on '&#123;func&#125;' is declared but not used. | Remove unused type parameters to avoid confusion. |
| **E006** `TYPEVAR_LIKE_UNDECLARED` | 🔴 error | Type variable-like '&#123;name&#125;' is used in '&#123;func&#125;' but not declared; declare it with 'of &#123;name&#125;'. | For names that look like type variables, declare them in the 'of' clause. |
| **E007** `TYPEVAR_INCONSISTENT` | 🔴 error | Type variable '&#123;name&#125;' inferred inconsistently: &#123;previous&#125; vs &#123;actual&#125; | Ensure all usage sites of a type variable produce the same concrete type. |
| **E008** `IF_BRANCH_MISMATCH` | 🔴 error | If branch type mismatch: then &#123;thenType&#125; vs else &#123;elseType&#125; | Ensure both branches of an if expression return the same type. |
| **E009** `MATCH_BRANCH_MISMATCH` | 🔴 error | Match case return types differ: &#123;expected&#125; vs &#123;actual&#125; | Check that all match branches return the same type. |
| **E010** `INTEGER_PATTERN_TYPE` | 🔴 error | Integer pattern used on non-Int scrutinee (&#123;scrutineeType&#125;) | Only use integer patterns on Int-typed match expressions. |
| **E011** `UNKNOWN_FIELD` | 🔴 error | Unknown field '&#123;field&#125;' for &#123;type&#125; | Check that the field name is correct for the data type. |
| **E012** `FIELD_TYPE_MISMATCH` | 🔴 error | Field '&#123;field&#125;' expects &#123;expected&#125;, got &#123;actual&#125; | Verify the field initializer expression matches the declared type. |
| **E013** `MISSING_REQUIRED_FIELD` | 🔴 error | Construction of &#123;type&#125; missing required field '&#123;field&#125;' | Provide all required fields declared in the data type. |
| **E014** `NOT_CALL_ARITY` | 🔴 error | not(...) expects 1 argument | Adjust the not() call to have exactly 1 argument. |
| **E015** `AWAIT_TYPE` | 🟡 warning | await expects Maybe&lt;T&gt; or Result&lt;T,E&gt;, got &#123;type&#125; | Only use await on Maybe or Result types. |
| **E016** `DUPLICATE_ENUM_CASE` | 🟡 warning | Duplicate enum case '&#123;case&#125;' in match on &#123;type&#125;. | Remove duplicate enum branches to keep the match concise. |
| **E017** `NON_EXHAUSTIVE_MAYBE` | 🟡 warning | Non-exhaustive match on Maybe type; missing &#123;missing&#125; case. | Add both null and non-null branches for Maybe matches. |
| **E018** `NON_EXHAUSTIVE_ENUM` | 🟡 warning | Non-exhaustive match on &#123;type&#125;; missing: &#123;missing&#125; | Add all uncovered enum branches, or add a wildcard. |
| **E019** `AMBIGUOUS_INTEROP_NUMERIC` | 🟡 warning | Ambiguous interop call '&#123;target&#125;': mixing numeric kinds (Int=&#123;hasInt&#125;, Long=&#123;hasLong&#125;, Double=&#123;hasDouble&#125;). Overload resolution may widen/box implicitly. | Unify numeric argument types in interop calls to avoid implicit boxing and widening. |
| **E020** `LIST_ELEMENT_TYPE_MISMATCH` | 🔴 error | List literal element type mismatch: expected &#123;expected&#125;, got &#123;actual&#125; | Ensure all elements in a list literal have the same type. |
| **E021** `OPTIONAL_EXPECTED` | 🔴 error | Optional value required here: expected Maybe or Option, but got &#123;actual&#125; | Pass a Maybe/Option type or explicitly wrap the value. |
| **E022** `WORKFLOW_COMPENSATE_TYPE` | 🔴 error | Compensate block for step '&#123;step&#125;' must return Result&lt;Unit, &#123;expectedErr&#125;&gt;, got &#123;actual&#125; | Ensure the compensate block returns Result&lt;Unit, E&gt; where E is the step error type. |
| **E024** `WORKFLOW_RETRY_INVALID` | 🔴 error | Workflow retry max attempts must be greater than zero (actual: &#123;maxAttempts&#125;). | Set retry.maxAttempts to a positive integer. |
| **E025** `WORKFLOW_TIMEOUT_INVALID` | 🔴 error | Workflow timeout must be greater than zero milliseconds (actual: &#123;milliseconds&#125;). | Set the timeout to a positive value to ensure compensate logic can be triggered. |
| **E030** `WORKFLOW_CIRCULAR_DEPENDENCY` | 🔴 error | Workflow contains circular step dependency: &#123;cycle&#125; | Remove or restructure circular dependencies to enable topological execution. |
| **E031** `DECIMAL_DOUBLE_MIXING` | 🔴 error | Cannot combine Decimal and Double in '&#123;operator&#125;'. Double is binary floating-point and would inject rounding error into an exact Decimal. Use Decimal literals (e.g. 1.08m) on both sides, or Int/Long (exact promotion). | Make both operands Decimal (suffix m), or use Int/Long which promote exactly to Decimal. |
| **E032** `CALL_ARITY_MISMATCH` | 🔴 error | Function '&#123;func&#125;' expects &#123;expected&#125; argument(s), got &#123;actual&#125;. | Adjust the call to pass exactly the declared number of arguments. |
| **E210** `EFFECT_VAR_UNDECLARED` | 🔴 error | Effect variable &#123;var&#125; undeclared | Add the effect type parameter to the function signature's effect parameter list. |
| **E211** `EFFECT_VAR_UNRESOLVED` | 🔴 error | Effect variable &#123;vars&#125; could not be resolved to concrete effects | Provide explicit effects (pure/cpu/io/workflow) or remove unused effect variables. |
| **E213** `EFFECT_PARAM_SHADOWS_BUILTIN` | 🔴 error | Effect parameter &#123;name&#125; of '&#123;func&#125;' has the same name as a built-in effect | Rename the effect parameter; the effect names io, cpu, pure and async are reserved in any letter case. |
| **W105** `WORKFLOW_RETRY_INCONSISTENT` | 🟡 warning | Workflow retry configuration may be unreasonable: &#123;reason&#125; | Check the combination of total wait time, maxAttempts, and backoff strategy. |
| **W106** `WORKFLOW_TIMEOUT_UNREASONABLE` | 🟡 warning | Workflow timeout configuration may be unreasonable: &#123;reason&#125; | Check whether the timeout value is too large or too small. |

## 附录

### 严重性级别

- 🔴 **error**: 阻止编译，必须修复
- 🟡 **warning**: 不阻止编译，但建议修复
- 🔵 **info**: 信息提示，可选择性处理

### 占位符说明

错误消息模板中的 `{name}` 形式表示占位符，运行时会被具体值替换。例如：
- `{expected}`、`{actual}`: 期望类型与实际类型
- `{func}`、`{name}`: 函数名或变量名
- `{capability}`: 能力名称（如 Http、Sql）

### 错误码编号规则

- **E001-E099**: 类型系统错误
- **E100-E199**: 作用域与导入错误
- **E200-E299**: 效果系统错误
- **E300-E399**: 能力系统错误
- **E400-E499**: PII 隐私相关错误
- **E500-E599**: 异步编程错误
- **E600-E699**: 降级（AST → Core IR）错误，lowering 阶段的 AST 不变量守卫与内部异常
- **E700-E799**: 治理（ADR 0039）与 Cedar 导出错误
- **E800-E899**: 名称解析（ADR 0051）错误
- **W0xx**: 警告级别错误码（使用 W 前缀）

---

*本文档由 `scripts/generate_error_code_docs.ts` 自动生成*
