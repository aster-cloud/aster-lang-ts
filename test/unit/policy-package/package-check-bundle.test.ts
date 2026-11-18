import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { compile } from '../../../src/browser.js';
import { compileSourcePositionFreeSha256 } from '../../../src/policy-package/package-check.js';

// `./package-check` 必须能在 Cloudflare Workers 运行（ADR 0059 修订 3 P2-R7）：
//   ① 以 platform=neutral 打包（不提供任何 Node 内置模块的解析），闭包里不得 import Node 内置模块；
//   ② 产物在 `--disallow-code-generation-from-strings` 的 Node 中运行（与 Workers 一样禁止 eval / new Function），
//      三个导出都能正常工作，结果与未打包的 dist 相同。
const ENTRY = join(process.cwd(), 'dist', 'src', 'policy-package', 'package-check.js');
const SOURCE = 'Module m.\n\nRule f given n as Int, produce Int:\n  Return n plus 1.';

test('platform=neutral 打包：闭包不引用 Node 内置模块与 worker_threads', async () => {
  const r = await build({
    entryPoints: [ENTRY],
    bundle: true,
    write: false,
    platform: 'neutral',
    format: 'esm',
    mainFields: ['module', 'main'],
    metafile: true,
    logLevel: 'silent',
  });
  const imports = Object.values(r.metafile.inputs).flatMap((i) => i.imports.map((x) => x.path));
  assert.deepEqual(imports.filter((p) => /^node:|^(fs|path|crypto|worker_threads|zlib|https|tls|module|os|url)$/.test(p)), []);
  const text = r.outputFiles[0]!.text;
  assert.doesNotMatch(text, /worker_threads|node:fs|node:crypto|\bBuffer\./);
});

test('打包产物在禁止动态生成代码的 Node 中运行，结果与 dist 相同', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'package-check-bundle-'));
  try {
    const bundle = join(dir, 'package-check.mjs');
    await build({ entryPoints: [ENTRY], bundle: true, outfile: bundle, platform: 'neutral', format: 'esm', mainFields: ['module', 'main'], logLevel: 'silent' });
    const c = compile(SOURCE);
    assert.ok(c.success && c.coreJson);
    const probes = JSON.stringify({ probes: [{ entry: 'f', expected: { ok: true, value: 3 }, input: { n: 2 } }, { entry: 'f', expected: { ok: true, value: 0 }, input: { n: 2 } }] });
    const runner = join(dir, 'run.mjs');
    writeFileSync(runner, `
      const m = await import(${JSON.stringify(pathToFileURL(bundle).href)});
      const [source, coreJson, probes] = JSON.parse(process.argv[2]);
      const out = {
        version: m.TS_VERSION,
        hash: m.compileSourcePositionFreeSha256(source, { locale: 'en-US', aliasSetJson: 'null', allowStructural: false }),
        probes: m.checkProbes(coreJson, probes, { maxSteps: 5000000, maxCallDepth: 10000, deadlineMs: 20000 }),
        builtins: m.EXPORT_BUILTINS.names.length,
      };
      let evalBlocked = false;
      try { new Function('return 1'); } catch { evalBlocked = true; }
      process.stdout.write(JSON.stringify({ ...out, evalBlocked }));
    `);
    const stdout = execFileSync(process.execPath, ['--disallow-code-generation-from-strings', runner, JSON.stringify([SOURCE, c.coreJson, probes])], { encoding: 'utf8' });
    const got = JSON.parse(stdout) as { version: string; hash: string; probes: unknown; builtins: number; evalBlocked: boolean };
    assert.equal(got.evalBlocked, true, '子进程须真正禁止动态生成代码');
    assert.equal(got.hash, compileSourcePositionFreeSha256(SOURCE, { locale: 'en-US', aliasSetJson: 'null', allowStructural: false }));
    assert.deepEqual(got.probes, { count: 2, agreed: 1, firstMismatch: { index: 1, expected: '{"ok":true,"value":0}', actual: '{"ok":true,"value":3}' } });
    assert.ok(got.builtins > 80);
    assert.match(got.version, /^\d+\.\d+\.\d+/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
