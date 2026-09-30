import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ★issue #195 / #201：`...process.env` 放在 GRADLE_USER_HOME 之后，宿主导出的
//   GRADLE_USER_HOME / GRADLE_OPTS / JAVA_OPTS 就把沙箱目录与 IPv4 偏好静默冲掉。
//   #195 只修了 scripts/aster.ts，#201 发现 emit-classfiles* 三处原样残留。
//   构造 Gradle 环境只允许经 gradleEnv()；这里对 scripts/ 与 src/ 做静态守卫：
//   同一对象字面量内 GRADLE_USER_HOME 之后不得再出现 ...process.env。

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SCAN_DIRS = ['scripts', 'src'];
const SOURCE_EXT = new Set(['.ts', '.js', '.mjs', '.cjs']);

function listSources(dir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name !== 'node_modules') listSources(p, out);
    } else if (SOURCE_EXT.has(path.extname(ent.name))) {
      out.push(p);
    }
  }
  return out;
}

/** 从 from 起向前扫到包含它的对象字面量的闭合 `}`（模板串里的 `${}` 自身配平，不干扰）。 */
function literalEnd(src: string, from: number): number {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}' && depth-- === 0) return i;
  }
  return src.length;
}

/** 返回「同一对象字面量内 GRADLE_USER_HOME 之后出现 ...process.env」的位置列表（行号取 GRADLE_USER_HOME 键所在行）。 */
function findHostOverrides(src: string): number[] {
  const hits: number[] = [];
  const re = /GRADLE_USER_HOME['"]?\s*:/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const body = src.slice(m.index, literalEnd(src, m.index));
    if (body.includes('...process.env')) hits.push(src.slice(0, m.index).split('\n').length);
  }
  return hits;
}

describe('gradleEnv 守卫：GRADLE_USER_HOME 之后禁止再展开 ...process.env', () => {
  it('探测器能抓住 #201 的原始形态（含模板串花括号）', () => {
    const bad = `const env = {
  GRADLE_USER_HOME: path.resolve('build/.gradle'),
  GRADLE_OPTS: \`\${process.env.GRADLE_OPTS ?? ''} -Djava.net.preferIPv4Stack=true\`.trim(),
  ...process.env,
};`;
    assert.deepEqual(findHostOverrides(bad), [2]);
  });

  it('探测器放过正确顺序与不相关的字面量', () => {
    const good = `const a = { ...process.env, GRADLE_USER_HOME: x };
const b = { GRADLE_USER_HOME: x };
const c = { ...process.env, ASTER_ROOT: process.cwd() };`;
    assert.deepEqual(findHostOverrides(good), []);
  });

  it('★scripts/ 与 src/ 中不存在宿主覆盖形态', () => {
    const files = SCAN_DIRS.flatMap(d => listSources(path.join(REPO_ROOT, d)));
    assert.ok(files.some(f => f.endsWith(path.join('cli', 'utils', 'gradle-env.ts'))), '扫描根目录定位错误');
    const offenders = files.flatMap(f =>
      findHostOverrides(fs.readFileSync(f, 'utf8')).map(line => `${path.relative(REPO_ROOT, f)}:${line}`)
    );
    assert.deepEqual(offenders, [], '这些位置须改用 gradleEnv()：宿主 GRADLE_USER_HOME 会覆盖沙箱配置');
  });
});
