import * as path from 'node:path';

const NET_OPTS = '-Djava.net.preferIPv4Stack=true -Djava.net.preferIPv6Stack=false';

/**
 * 构造调用 Gradle 子进程的环境变量。
 *
 * 显式设定的 GRADLE_USER_HOME / GRADLE_OPTS / JAVA_OPTS 必须**覆盖**宿主环境，
 * 因此 `...base` 展开放在最前；此前放在末尾，宿主只要设了同名变量就把这里的
 * 值静默冲掉，IPv4 优先与项目内 Gradle 缓存目录两项刻意配置全部失效。
 */
export function gradleEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    GRADLE_USER_HOME: path.resolve('build/.gradle'),
    GRADLE_OPTS: `${base.GRADLE_OPTS ?? ''} ${NET_OPTS}`.trim(),
    JAVA_OPTS: `${base.JAVA_OPTS ?? ''} ${NET_OPTS}`.trim(),
  };
}
