/**
 * 包格式 CLI 的命令行语法（README「命令行」，ADR 0059 修订 2 R8）。
 *
 * 两个 CLI 的参数解析库（cac / picocli）缺省行为不同，因此这里手写同一套严格语法：
 *   - 子命令 `compile`、`run`、`verify`、`inspect`、`version`；未知子命令为 USAGE；
 *   - 带值选项写成 `--opt value` 或 `--opt=value`；开关不接受 `=`；选项与位置参数先后任意；
 *   - 同一选项出现两次、未知选项、缺值、位置参数个数不对都是 USAGE；
 *   - `--opt value` 形式中，若下一个 token 本身是该子命令认识的选项（`--x` 或 `--x=…`），视为缺值（与 picocli 缺省相同）。
 *   - `--timeout` 匹配 `^(0|[1-9][0-9]*)(ms|s)(?![\s\S])`，> 0 且 ≤ 300 s；缺省 5 s。
 */
import { fail } from './errors.js';

export type Command = 'compile' | 'run' | 'verify' | 'inspect' | 'version';

interface CommandSpec {
  readonly values: readonly string[];
  readonly flags: readonly string[];
  readonly positionals: 0 | 1;
}

const SPECS: Readonly<Record<Command, CommandSpec>> = {
  run: { values: ['entry', 'input', 'timeout', 'jwks', 'pubkey'], flags: ['allow-unsigned'], positionals: 1 },
  verify: { values: ['timeout', 'jwks', 'pubkey'], flags: ['allow-unsigned', 'recompile', 'probes'], positionals: 1 },
  inspect: { values: ['jwks', 'pubkey'], flags: ['allow-unsigned'], positionals: 1 },
  compile: {
    values: ['locale', 'alias-set', 'vocabulary', 'out', 'jwks', 'pubkey'],
    flags: ['allow-structural', 'allow-unsigned'],
    positionals: 1,
  },
  version: { values: [], flags: [], positionals: 0 },
};

/** 已解析的命令行。 */
export interface ParsedArgs {
  readonly command: Command;
  /** 位置参数（包路径或 .aster 文件），`version` 为 undefined */
  readonly path: string | undefined;
  readonly values: ReadonlyMap<string, string>;
  readonly flags: ReadonlySet<string>;
  /** `--timeout` 的毫秒数（缺省 5000） */
  readonly timeoutMs: number;
}

export const DEFAULT_TIMEOUT_MS = 5000;
export const MAX_TIMEOUT_MS = 300_000;
const TIMEOUT = /^(0|[1-9][0-9]*)(ms|s)(?![\s\S])/;

const usage = (why: string): never => fail('usage', 'USAGE', why);

/** `--timeout` 文本 → 毫秒。 */
export function parseTimeout(text: string): number {
  const m = TIMEOUT.exec(text);
  if (!m) return usage(`--timeout 语法不合法：${text}`);
  const n = Number(m[1]) * (m[2] === 's' ? 1000 : 1);
  if (!(n > 0) || n > MAX_TIMEOUT_MS) usage(`--timeout 必须 > 0 且 ≤ 300s：${text}`);
  return n;
}

export function isCommand(s: string | undefined): s is Command {
  return s !== undefined && Object.hasOwn(SPECS, s);
}

/** 解析 argv（不含 node 与脚本路径）。 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command, ...rest] = argv;
  if (!isCommand(command)) return usage(`未知子命令：${command ?? '（缺失）'}`);
  const spec = SPECS[command];
  const isKnownOption = (tok: string): boolean => {
    if (!tok.startsWith('--')) return false;
    const name = tok.slice(2).split('=')[0]!;
    return spec.values.includes(name) || spec.flags.includes(name);
  };
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i]!;
    if (!tok.startsWith('--')) {
      positionals.push(tok);
      continue;
    }
    const eq = tok.indexOf('=');
    const name = eq < 0 ? tok.slice(2) : tok.slice(2, eq);
    if (values.has(name) || flags.has(name)) usage(`选项重复：--${name}`);
    if (spec.flags.includes(name)) {
      if (eq >= 0) usage(`开关 --${name} 不接受值`);
      flags.add(name);
      continue;
    }
    if (!spec.values.includes(name)) usage(`未知选项：${tok}`);
    if (eq >= 0) {
      values.set(name, tok.slice(eq + 1));
      continue;
    }
    const next = rest[i + 1];
    if (next === undefined || isKnownOption(next)) usage(`--${name} 缺少值`);
    values.set(name, next!);
    i++;
  }
  if (positionals.length !== spec.positionals) usage(`${command} 需要 ${spec.positionals} 个位置参数，实际 ${positionals.length} 个`);
  if (command === 'run' && !values.has('input')) usage('run 必须给出 --input（- 表示 stdin）');
  const timeout = values.get('timeout');
  return { command, path: positionals[0], values, flags, timeoutMs: timeout === undefined ? DEFAULT_TIMEOUT_MS : parseTimeout(timeout) };
}
