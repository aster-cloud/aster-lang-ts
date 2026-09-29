import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { gradleEnv } from '../../../src/cli/utils/gradle-env.js';

// ★issue #195：`...process.env` 原本放在展开末尾，宿主设了 GRADLE_USER_HOME /
//   GRADLE_OPTS / JAVA_OPTS 就把刻意配置的值静默冲掉。
describe('gradleEnv：显式配置必须覆盖宿主环境', () => {
  const host = {
    PATH: '/usr/bin',
    GRADLE_USER_HOME: '/home/user/.gradle',
    GRADLE_OPTS: '-Xmx1g',
    JAVA_OPTS: '-Dfoo=bar',
  };
  const env = gradleEnv(host);

  it('GRADLE_USER_HOME 指向项目内 build/.gradle，而不是宿主值', () => {
    assert.equal(env.GRADLE_USER_HOME, path.resolve('build/.gradle'));
  });

  it('GRADLE_OPTS / JAVA_OPTS 在宿主值之后追加 IPv4 优先参数', () => {
    assert.equal(env.GRADLE_OPTS, '-Xmx1g -Djava.net.preferIPv4Stack=true -Djava.net.preferIPv6Stack=false');
    assert.equal(env.JAVA_OPTS, '-Dfoo=bar -Djava.net.preferIPv4Stack=true -Djava.net.preferIPv6Stack=false');
  });

  it('宿主其余变量原样透传', () => {
    assert.equal(env.PATH, '/usr/bin');
  });

  it('宿主未设 OPTS 时不留前导空格', () => {
    const bare = gradleEnv({});
    assert.equal(bare.GRADLE_OPTS, '-Djava.net.preferIPv4Stack=true -Djava.net.preferIPv6Stack=false');
    assert.equal(bare.JAVA_OPTS, '-Djava.net.preferIPv4Stack=true -Djava.net.preferIPv6Stack=false');
  });
});
