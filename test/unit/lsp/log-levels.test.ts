/**
 * LSP 日志级别：Logger 按真实级别映射到 window/logMessage 类型，
 * 默认（WARN）不把 INFO / DEBUG 与 [TypecheckCache] 诊断日志推给客户端。
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { LogLevel, Logger, installLogSink } from '../../../src/utils/logger.js';
import { createLspLogSink, installLspLogSink, LSP_DEFAULT_LOG_LEVEL, type LspConsole } from '../../../src/lsp/log-sink.js';
import { computeDiagnostics, invalidateDiagnosticCache } from '../../../src/lsp/diagnostics.js';
import { ConfigService } from '../../../src/config/config-service.js';
import { ZH_CN } from '../../../src/config/lexicons/zh-CN.js';
import { DECLS, docOf, getOrParseWith } from './resolution-fixture.js';

/** 记录 logMessage 类型：1=Error 2=Warning 3=Info 4=Log */
function recordingConsole(): { console: LspConsole; messages: Array<{ type: number; text: string }> } {
  const messages: Array<{ type: number; text: string }> = [];
  const push = (type: number) => (text: string) => void messages.push({ type, text });
  return { console: { error: push(1), warn: push(2), info: push(3), log: push(4) }, messages };
}

const restores: Array<() => void> = [];
const envBackup = { ASTER_LOG_LEVEL: process.env.ASTER_LOG_LEVEL, LOG_LEVEL: process.env.LOG_LEVEL };

function install(sinkFactory: () => () => void): void {
  restores.push(sinkFactory());
}

afterEach(() => {
  while (restores.length) restores.pop()!();
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  ConfigService.resetForTesting();
});

function withEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  ConfigService.resetForTesting();
}

describe('LSP 日志级别映射', () => {
  it('默认 WARN：INFO / DEBUG 不产生 logMessage', () => {
    withEnv('ASTER_LOG_LEVEL', undefined);
    withEnv('LOG_LEVEL', undefined);
    const { console, messages } = recordingConsole();
    install(() => installLspLogSink(console));
    const logger = new Logger('typecheck', LogLevel.DEBUG);
    logger.debug('d');
    logger.info('i');
    assert.deepEqual(messages, []);
    assert.equal(LSP_DEFAULT_LOG_LEVEL, LogLevel.WARN);
  });

  it('WARN 产生 type 2，ERROR 产生 type 1，且内容为 JSON 行', () => {
    withEnv('ASTER_LOG_LEVEL', undefined);
    withEnv('LOG_LEVEL', undefined);
    const { console, messages } = recordingConsole();
    install(() => installLspLogSink(console));
    const logger = new Logger('typecheck');
    logger.warn('w');
    logger.error('e', new Error('boom'));
    assert.deepEqual(messages.map((m) => m.type), [2, 1]);
    assert.equal(JSON.parse(messages[0]!.text).level, 'WARN');
    assert.equal(JSON.parse(messages[1]!.text).error, 'boom');
  });

  it('ASTER_LOG_LEVEL 可调高：INFO→3，DEBUG→4', () => {
    withEnv('ASTER_LOG_LEVEL', 'debug');
    const { console, messages } = recordingConsole();
    install(() => installLspLogSink(console));
    const logger = new Logger('typecheck');
    logger.info('i');
    logger.debug('d');
    assert.deepEqual(messages.map((m) => m.type), [3, 4]);
  });

  it('ASTER_LOG_LEVEL=error 压低到只发 ERROR', () => {
    withEnv('ASTER_LOG_LEVEL', 'error');
    const { console, messages } = recordingConsole();
    install(() => installLspLogSink(console));
    const logger = new Logger('x');
    logger.warn('w');
    logger.error('e');
    assert.deepEqual(messages.map((m) => m.type), [1]);
  });

  it('落点恢复后回到 stderr 行为', () => {
    const { console, messages } = recordingConsole();
    const restore = installLogSink(createLspLogSink(console, LogLevel.DEBUG));
    restore();
    const original = globalThis.console.error;
    const seen: unknown[] = [];
    globalThis.console.error = (line: unknown) => void seen.push(line);
    try {
      new Logger('x', LogLevel.INFO).info('cli');
    } finally {
      globalThis.console.error = original;
    }
    assert.equal(messages.length, 0);
    assert.equal(seen.length, 1);
  });

  it('CLI 默认不安装落点：INFO 仍写 stderr', () => {
    const original = globalThis.console.error;
    const seen: string[] = [];
    globalThis.console.error = (line: unknown) => void seen.push(String(line));
    try {
      new Logger('cli', LogLevel.INFO).info('hello');
      new Logger('cli', LogLevel.INFO).debug('hidden');
    } finally {
      globalThis.console.error = original;
    }
    assert.equal(seen.length, 1);
    assert.equal(JSON.parse(seen[0]!).level, 'INFO');
  });
});

describe('[TypecheckCache] 诊断日志', () => {
  const GOOD = ['规则 检查 给定 x 作为 司机，产出 整数：', '  返回 x.alter。', ''];

  async function runTwice(): Promise<void> {
    const doc = docOf([...DECLS, ...GOOD]);
    const getOrParse = getOrParseWith(ZH_CN) as never;
    await computeDiagnostics(doc.document, getOrParse, ZH_CN);
    invalidateDiagnosticCache(doc.document.uri);
    await computeDiagnostics(doc.document, getOrParse, ZH_CN);
  }

  it('默认级别下不输出，也不写 stderr', async () => {
    withEnv('ASTER_LOG_LEVEL', undefined);
    withEnv('LOG_LEVEL', undefined);
    const { console, messages } = recordingConsole();
    install(() => installLspLogSink(console));
    const original = globalThis.console.error;
    const stderr: unknown[] = [];
    globalThis.console.error = (...a: unknown[]) => void stderr.push(a);
    try {
      await runTwice();
    } finally {
      globalThis.console.error = original;
    }
    assert.deepEqual(messages.filter((m) => m.text.includes('TypecheckCache')), []);
    assert.deepEqual(stderr.filter((a) => String(a).includes('TypecheckCache')), []);
  });

  it('调到 DEBUG 后以 type 4 输出（缓存写入与命中）', async () => {
    withEnv('ASTER_LOG_LEVEL', 'debug');
    const { console, messages } = recordingConsole();
    install(() => installLspLogSink(console));
    await runTwice();
    const cache = messages.filter((m) => m.text.includes('[TypecheckCache]'));
    assert.ok(cache.length >= 1, '应至少有一条 TypecheckCache 日志');
    assert.ok(cache.every((m) => m.type === 4));
    assert.ok(cache.some((m) => m.text.includes('Cached')));
  });
});
