#!/usr/bin/env node
import fs from 'node:fs';
import * as cp from 'node:child_process';
import * as path from 'node:path';
import { canonicalize, lex, lowerModule } from '../src/index.js';
import { parse as parseAst } from '../src/parser.js';
import { emitJava } from '../src/jvm/emitter.js';
import cac from 'cac';
import { installCommand, type InstallOptions } from '../src/cli/commands/install.js';
import { listCommand, type ListOptions } from '../src/cli/commands/list.js';
import { updateCommand } from '../src/cli/commands/update.js';
import { searchCommand } from '../src/cli/commands/search.js';
import { aiGenerateCommand, type AIGenerateOptions } from '../src/cli/commands/ai-generate.js';
import { handleError } from '../src/cli/utils/error-handler.js';

function readFileStrict(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

function sh(cmd: string, opts: cp.ExecSyncOptions = {}): void {
  cp.execSync(cmd, { stdio: 'inherit', ...opts });
}

async function cmdParse(file: string): Promise<void> {
  const input = readFileStrict(file);
  const can = canonicalize(input);
  const toks = lex(can);
  const { ast } = parseAst(toks);
  console.log(JSON.stringify(ast, null, 2));
}

async function cmdCore(file: string): Promise<void> {
  const input = readFileStrict(file);
  const core = lowerModule(parseAst(lex(canonicalize(input))).ast);
  console.log(JSON.stringify(core, null, 2));
}

async function cmdJvm(file: string, outDir = 'build/jvm-src'): Promise<void> {
  const input = readFileStrict(file);
  const core = lowerModule(parseAst(lex(canonicalize(input))).ast);
  fs.rmSync(outDir, { recursive: true, force: true });
  await emitJava(core, outDir);
  console.log('Wrote Java sources to', outDir);
}

async function ensureAsmEmitterBuilt(): Promise<void> {
  const hasWrapper = fs.existsSync('./gradlew');
  const buildDir = 'aster-asm-emitter/build/libs';
  const hasJar = fs.existsSync(buildDir) && fs.readdirSync(buildDir).some(f => f.endsWith('.jar'));
  if (!hasJar) {
    const buildCmd = hasWrapper
      ? './gradlew :aster-asm-emitter:build'
      : 'gradle :aster-asm-emitter:build';
    try {
      sh(buildCmd, {
        env: {
          GRADLE_USER_HOME: path.resolve('build/.gradle'),
          GRADLE_OPTS: `${process.env.GRADLE_OPTS ?? ''} -Djava.net.preferIPv4Stack=true -Djava.net.preferIPv6Stack=false`.trim(),
          JAVA_OPTS: `${process.env.JAVA_OPTS ?? ''} -Djava.net.preferIPv4Stack=true -Djava.net.preferIPv6Stack=false`.trim(),
          ...process.env,
        },
      });
    } catch (e) {
      console.error('Failed to build ASM emitter');
      throw e;
    }
  }
}

async function cmdClass(file: string, outDir = 'build/jvm-classes'): Promise<void> {
  await ensureAsmEmitterBuilt();
  const input = readFileStrict(file);
  const core = lowerModule(parseAst(lex(canonicalize(input))).ast);
  const payload = JSON.stringify(core);
  fs.mkdirSync('build', { recursive: true });
  fs.writeFileSync('build/last-core.json', payload);
  const runCmd = fs.existsSync('./gradlew') ? './gradlew' : 'gradle';
  await new Promise<void>((resolve, reject) => {
    const env = {
      GRADLE_USER_HOME: path.resolve('build/.gradle'),
      GRADLE_OPTS: `${process.env.GRADLE_OPTS ?? ''} -Djava.net.preferIPv4Stack=true -Djava.net.preferIPv6Stack=false`.trim(),
      JAVA_OPTS: `${process.env.JAVA_OPTS ?? ''} -Djava.net.preferIPv4Stack=true -Djava.net.preferIPv6Stack=false`.trim(),
      ...process.env,
    };
    const proc = cp.spawn(runCmd, [':aster-asm-emitter:run', `--args=${path.resolve(outDir)}`], {
      stdio: ['pipe', 'inherit', 'inherit'],
      env,
    });
    proc.on('error', reject);
    proc.on('close', code =>
      code === 0 ? resolve() : reject(new Error(`emitter exited ${code}`))
    );
    proc.stdin.write(payload);
    proc.stdin.end();
  });
  console.log('Emitted classes to', outDir);
}

async function cmdJar(
  optionalFile: string | undefined,
  outFile = 'build/aster-out/aster.jar'
): Promise<void> {
  if (optionalFile) {
    await cmdClass(optionalFile);
  }
  const classes = 'build/jvm-classes';
  if (!fs.existsSync(classes)) {
    console.error('No classes found:', classes);
    process.exit(2);
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  sh(`jar --create --file ${outFile} -C ${classes} .`);
  console.log('Wrote', outFile);
}

async function cmdTruffle(input: string, passthrough: string[]): Promise<void> {
  // Prepare Core JSON path
  let corePath = input;
  if (input.endsWith('.aster')) {
    const src = readFileStrict(input);
    const core = lowerModule(parseAst(lex(canonicalize(src))).ast);
    fs.mkdirSync('build', { recursive: true });
    corePath = path.join('build', `${path.basename(input, '.aster')}_core.json`);
    fs.writeFileSync(corePath, JSON.stringify(core));
  }
  // Run Truffle runner via Gradle
  const hasWrapper = fs.existsSync('./gradlew');
  const runCmd = hasWrapper ? './gradlew' : 'gradle';
  // Handle --profile flag: set env var
  const pass = [...passthrough];
  const profileIdx = pass.indexOf('--profile');
  const env: Record<string, string | undefined> = { ...process.env };
  if (profileIdx >= 0) {
    pass.splice(profileIdx, 1);
    env.ASTER_TRUFFLE_PROFILE = '1';
  }
  const argsStr = [corePath, ...pass].join(' ');
  await new Promise<void>((resolve, reject) => {
    const env2 = {
      GRADLE_USER_HOME: path.resolve('build/.gradle'),
      GRADLE_OPTS: `${process.env.GRADLE_OPTS ?? ''} -Djava.net.preferIPv4Stack=true -Djava.net.preferIPv6Stack=false`.trim(),
      ...env,
    };
    const proc = cp.spawn(runCmd, [':aster-truffle:run', `--args=${argsStr}`], {
      stdio: 'inherit',
      env: env2,
    });
    proc.on('error', reject);
    proc.on('close', code =>
      code === 0 ? resolve() : reject(new Error(`truffle exited ${code}`))
    );
  });
}

function wrapAction<Args extends unknown[]>(fn: (...args: Args) => Promise<void> | void) {
  return async (...args: Args): Promise<void> => {
    try {
      await fn(...args);
    } catch (error) {
      handleError(error);
    }
  };
}

async function runMaybeWatch(file: string, watch: boolean, runner: () => Promise<void>): Promise<void> {
  if (!watch) {
    await runner();
    return;
  }

  const safeRunner = async (): Promise<void> => {
    try {
      await runner();
    } catch (error) {
      console.error(error);
    }
  };

  await safeRunner();
  await watchFile(file, safeRunner);
}

async function main(): Promise<void> {
  const cli = cac('aster');

  cli
    .command('parse <file>', '解析 .aster 文件为 AST(JSON)')
    .option('--watch', '监听文件变化并重新执行', { default: false })
    .action(
      wrapAction(async (file: string, options: { watch?: boolean }) => {
        await runMaybeWatch(file, Boolean(options.watch), () => cmdParse(file));
      })
    );

  cli
    .command('core <file>', 'Lower AST → Core IR (JSON)')
    .option('--watch', '监听文件变化', { default: false })
    .action(
      wrapAction(async (file: string, options: { watch?: boolean }) => {
        await runMaybeWatch(file, Boolean(options.watch), () => cmdCore(file));
      })
    );

  cli
    .command('jvm <file>', '输出 Java 源码 (默认 build/jvm-src)')
    .option('--out <dir>', '目标目录', { default: 'build/jvm-src' })
    .option('--watch', '监听文件变化', { default: false })
    .action(
      wrapAction(async (file: string, options: { out?: string; watch?: boolean }) => {
        const outDir = options.out ?? 'build/jvm-src';
        await runMaybeWatch(file, Boolean(options.watch), () => cmdJvm(file, outDir));
      })
    );

  cli
    .command('class <file>', '生成 .class 文件 (默认 build/jvm-classes)')
    .option('--out <dir>', '目标目录', { default: 'build/jvm-classes' })
    .option('--watch', '监听文件变化', { default: false })
    .action(
      wrapAction(async (file: string, options: { out?: string; watch?: boolean }) => {
        const outDir = options.out ?? 'build/jvm-classes';
        await runMaybeWatch(file, Boolean(options.watch), () => cmdClass(file, outDir));
      })
    );

  cli
    .command('jar [file]', '打包 JAR（可选：先从 Aster 文件生成类文件）')
    .option('--out <file>', '输出 JAR 路径', { default: 'build/aster-out/aster.jar' })
    .action(
      wrapAction(async (file: string | undefined, options: { out?: string }) => {
        const outFile = options.out ?? 'build/aster-out/aster.jar';
        await cmdJar(file, outFile);
      })
    );

  cli
    .command('truffle <file>', '在 Truffle 中运行 Core IR（自动处理 .aster 输入）')
    .allowUnknownOptions()
    .action(
      wrapAction(async (file: string, options: { '--'?: string[] }) => {
        const pass = Array.isArray(options['--']) ? options['--'] : [];
        await cmdTruffle(file, pass);
      })
    );

  cli
    .command('list', '列出已安装的包')
    .option('--outdated', '显示是否可更新', { default: false })
    .option('--json', '以 JSON 格式输出', { default: false })
    .action(
      wrapAction(async (options: { outdated?: boolean; json?: boolean }) => {
        const listOptions: ListOptions = {
          outdated: Boolean(options.outdated),
          json: Boolean(options.json),
        };
        await listCommand(listOptions);
      })
    );

  cli
    .command('update [package]', '更新包到最新版本')
    .action(
      wrapAction(async (pkg?: string) => {
        await updateCommand(pkg);
      })
    );

  cli
    .command('search <keyword>', '搜索可用的包')
    .action(
      wrapAction(async (keyword: string) => {
        await searchCommand(keyword);
      })
    );

  cli
    .command('install <package>', '安装 Aster 包依赖')
    .option('--save-dev', '写入 devDependencies', { default: false })
    .option('--no-lock', '跳过 .aster.lock 更新', { default: false })
    .option('--registry <registry>', '自定义注册表（local/URL/本地路径）')
    .action(
      wrapAction(async (pkg: string, options: Record<string, unknown>) => {
        const installOptions: InstallOptions = {
          saveDev: Boolean(options.saveDev),
          noLock: Boolean(options.noLock),
        };
        if (typeof options.registry === 'string') {
          installOptions.registry = options.registry;
        }
        await installCommand(pkg, installOptions);
      })
    );

  cli
    .command('ai-generate <description>', '使用 AI 从英文描述生成 Aster 代码')
    .option('--provider <provider>', 'LLM Provider (openai 或 anthropic)', { default: 'openai' })
    .option('--model <model>', '模型名称（如 gpt-4-turbo, claude-3-5-sonnet-20241022）')
    .option('--output <file>', '输出文件路径（不指定则输出到控制台）')
    .option('--temperature <temp>', '温度参数（0.0-1.0）', { default: undefined })
    .option('--few-shot-count <count>', 'Few-shot 示例数量', { default: undefined })
    .option('--no-cache', '禁用生成结果缓存', { default: false })
    .action(
      wrapAction(async (description: string, options: Record<string, unknown>) => {
        const aiOptions: AIGenerateOptions = {
          provider: options.provider === 'anthropic' ? 'anthropic' : 'openai',
        };
        if (typeof options.model === 'string') {
          aiOptions.model = options.model;
        }
        if (typeof options.output === 'string') {
          aiOptions.output = options.output;
        }
        if (typeof options.temperature === 'number') {
          aiOptions.temperature = options.temperature;
        }
        if (typeof options.fewShotCount === 'number') {
          aiOptions.fewShotCount = options.fewShotCount;
        }
        if (typeof options.noCache === 'boolean' && options.noCache) {
          aiOptions.useCache = false;
        }
        await aiGenerateCommand(description, aiOptions);
      })
    );

  cli
    .command('help', '显示使用说明')
    .action(() => {
      cli.outputHelp();
    });

  cli.help();
  cli.parse();
}

main().catch(handleError);

async function watchFile(file: string, run: () => void | Promise<void>): Promise<void> {
  console.log('Watching', file, '(Ctrl+C to exit)');
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const trigger: () => void = () => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      console.log('— change detected —');
      Promise.resolve(run()).catch(err => console.error(err));
    }, 100);
  };
  try {
    fs.watch(file, { persistent: true }, trigger);
  } catch (e) {
    console.error('Failed to watch file:', file, e);
    process.exit(1);
  }
  // Keep process alive indefinitely
  await new Promise<void>(resolve => void resolve);
}
