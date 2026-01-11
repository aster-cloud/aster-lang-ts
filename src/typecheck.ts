export * from './typecheck/index.js';

declare global {
  // LSP 配置全局注入接口（避免循环依赖）
  var lspConfig: { enforcePiiChecks?: boolean } | undefined;
}
