# Hindi (Devanagari) POC — Phase 0 of ADR 0017

一次性可行性验证：手写 Hindi lexicon (`hi-IN.poc.ts`)，用现有 `compileAndTypecheck`
验证 Devanagari 非拉丁脚本能 lex → parse → compile 到 Core IR。

跑：`npx tsx scripts/poc-hindi/verify.ts` → 应 3/3 通过（**前提**：需在
`src/frontend/lexer.ts` 的 `isLetter()` english 分支临时加 Devanagari 范围
`0x0900–0x097F` 且排除 danda `0x0964/0x0965`——见 ADR 0017 Phase 0 result）。

⚠️ 非生产：不进 generate-lexicons 管线、不注册 registry。真正的 lexer 修复 +
完整 Hindi lexicon 是 Phase 1（Java core 镜像 + 双引擎 parity + 测试）。
