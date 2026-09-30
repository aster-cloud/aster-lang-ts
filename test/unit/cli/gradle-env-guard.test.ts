import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ★issue #195 / #201：`...process.env` 放在 GRADLE_USER_HOME 之后，宿主导出的
//   GRADLE_USER_HOME / GRADLE_OPTS / JAVA_OPTS 就把沙箱目录与 IPv4 偏好静默冲掉。
//   #195 只修了 scripts/aster.ts，#201 发现 emit-classfiles* 三处原样残留。
//   构造 Gradle 环境只允许经 gradleEnv()。这里不再用手写括号匹配器识别「错误形态」，
//   而是守一条更强的单一不变量：scripts/ 与 src/ 之下，除 gradle-env.ts 外任何源码
//   都不得出现字面量 GRADLE_USER_HOME——Object.assign、改名后的展开、任何重新实现
//   一律被抓住，且没有解析器会被字符串里的花括号带偏。

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SCAN_DIRS = ['scripts', 'src'];
const SOURCE_EXT = new Set(['.ts', '.js', '.mjs', '.cjs']);
const ONLY_ALLOWED = path.join('src', 'cli', 'utils', 'gradle-env.ts');
const LITERAL = 'GRADLE_USER_HOME';

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

/** 返回 scripts/ 与 src/ 下含 GRADLE_USER_HOME 字面量、且不是 gradle-env.ts 的源文件（仓库相对路径）。 */
function findOffenders(): string[] {
  return SCAN_DIRS.flatMap(d => listSources(path.join(REPO_ROOT, d)))
    .map(f => path.relative(REPO_ROOT, f))
    .filter(rel => rel !== ONLY_ALLOWED && fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').includes(LITERAL));
}

describe('gradleEnv 守卫：GRADLE_USER_HOME 只许出现在 gradle-env.ts', () => {
  it('探测器能抓住 scripts/ 下新出现的 GRADLE_USER_HOME（自检）', () => {
    const tmp = path.join(REPO_ROOT, 'scripts', `.gradle-env-guard-selfcheck-${process.pid}.ts`);
    fs.writeFileSync(tmp, `// ${LITERAL}\n`);
    try {
      assert.ok(findOffenders().includes(path.relative(REPO_ROOT, tmp)), '探测器未能识别新增的违规文件');
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  it('★scripts/ 与 src/ 中 GRADLE_USER_HOME 仅存在于 gradle-env.ts', () => {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, ONLY_ALLOWED)), '扫描根目录定位错误');
    assert.deepEqual(findOffenders(), [], '这些文件须改用 gradleEnv()：Gradle 环境只允许在 gradle-env.ts 内构造');
  });
});
