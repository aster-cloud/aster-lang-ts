#!/usr/bin/env node
import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalize } from '../src/frontend/canonicalizer.js';
import { lex } from '../src/frontend/lexer.js';
import { parse } from '../src/parser.js';
import { lowerModule } from '../src/lower_to_core.js';
import { emitJava } from '../src/jvm/emitter.js';
import type { Core as CoreIR } from '../src/types.js';

const FINANCE_DTO_PACKAGE = 'com.wontlost.aster.finance.dto';
const FINANCE_DTO_DIR = path.resolve(
  'aster-finance/src/main/java',
  ...FINANCE_DTO_PACKAGE.split('.')
);
const FINANCE_DTO_MODULES = new Set([
  'aster.finance.loan',
  'aster.finance.creditcard',
  'aster.finance.fraud',
  'aster.finance.risk',
  'aster.finance.personal_lending',
  'aster.finance.enterprise_lending',
  'aster.insurance.life',
  'aster.insurance.auto',
  'aster.healthcare.eligibility',
  'aster.healthcare.claims',
]);
let financeDtoInitialized = false;

interface JavaTypeInfo {
  readonly type: string;
  readonly primitive: boolean;
  readonly nullable: boolean;
  readonly imports: Set<string>;
}

function shouldUseFinanceDto(moduleName: string | null | undefined): boolean {
  return !!moduleName && FINANCE_DTO_MODULES.has(moduleName);
}

function ensureFinanceDtoDir(): void {
  if (financeDtoInitialized) return;
  fs.rmSync(FINANCE_DTO_DIR, { recursive: true, force: true });
  fs.mkdirSync(FINANCE_DTO_DIR, { recursive: true });
  financeDtoInitialized = true;
}

function generateFinanceDtos(core: CoreIR.Module): void {
  if (!shouldUseFinanceDto(core.name)) return;
  ensureFinanceDtoDir();
  for (const decl of core.decls) {
    if (decl.kind !== 'Data') continue;
    const filePath = path.join(FINANCE_DTO_DIR, `${decl.name}.java`);
    const content = renderFinanceDto(core.name ?? 'app', decl);
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

function renderFinanceDto(moduleName: string, data: CoreIR.Data): string {
  const imports = new Set<string>();
  const fieldBlocks = data.fields.map((field, idx) => renderDtoField(field, idx === data.fields.length - 1, imports));
  const importLines = [...imports].sort().map(i => `import ${i};`).join('\n');
  const importSection = importLines ? `${importLines}\n\n` : '';
  const doc = `/**\n * Aster DSL 自动生成 DTO：${data.name}（模块 ${moduleName}）。\n */`;
  return `package ${FINANCE_DTO_PACKAGE};\n\n${importSection}${doc}\npublic record ${data.name}(\n${fieldBlocks.join('\n')}\n) {}\n`;
}

function renderDtoField(field: CoreIR.Field, isLast: boolean, imports: Set<string>): string {
  const typeInfo = resolveJavaType(field.type);
  typeInfo.imports.forEach(i => imports.add(i));
  const annotations: string[] = [];
  if (!typeInfo.primitive && !typeInfo.nullable) {
    annotations.push('@NotNull');
    imports.add('jakarta.validation.constraints.NotNull');
  }
  const lines = annotations.map(a => `  ${a}`);
  const suffix = isLast ? '' : ',';
  lines.push(`  ${typeInfo.type} ${field.name}${suffix}`);
  return lines.join('\n');
}

function resolveJavaType(t: CoreIR.Type): JavaTypeInfo {
  switch (t.kind) {
    case 'TypeName':
      return mapTypeName(t.name);
    case 'List': {
      const inner = resolveJavaType(t.type);
      const imports = new Set(inner.imports);
      imports.add('java.util.List');
      return { type: `List<${inner.type}>`, primitive: false, nullable: inner.nullable, imports };
    }
    case 'Map': {
      const key = resolveJavaType(t.key);
      const val = resolveJavaType(t.val);
      const imports = new Set([...key.imports, ...val.imports]);
      imports.add('java.util.Map');
      return { type: `Map<${key.type}, ${val.type}>`, primitive: false, nullable: key.nullable || val.nullable, imports };
    }
    case 'Maybe':
    case 'Option': {
      const inner = resolveJavaType(t.type);
      return { type: inner.type, primitive: inner.primitive, nullable: true, imports: inner.imports };
    }
    default:
      return { type: 'Object', primitive: false, nullable: false, imports: new Set() };
  }
}

function mapTypeName(name: string): JavaTypeInfo {
  switch (name) {
    case 'Int':
      return { type: 'int', primitive: true, nullable: false, imports: new Set() };
    case 'Bool':
      return { type: 'boolean', primitive: true, nullable: false, imports: new Set() };
    case 'Long':
      return { type: 'long', primitive: true, nullable: false, imports: new Set() };
    case 'Double':
      return { type: 'double', primitive: true, nullable: false, imports: new Set() };
    case 'Text':
    case 'Text?':
      return { type: 'String', primitive: false, nullable: name.endsWith('?'), imports: new Set() };
    default:
      return { type: name, primitive: false, nullable: false, imports: new Set() };
  }
}

function envWithGradle(): Record<string, string | undefined> {
  return {
    GRADLE_USER_HOME: path.resolve('build/.gradle'),
    GRADLE_OPTS: `${process.env.GRADLE_OPTS ?? ''} -Djava.net.preferIPv4Stack=true -Djava.net.preferIPv6Stack=false`.trim(),
    JAVA_OPTS: `${process.env.JAVA_OPTS ?? ''} -Djava.net.preferIPv4Stack=true -Djava.net.preferIPv6Stack=false`.trim(),
    ...process.env,
  };
}

const JVM_SRC_DIR = path.resolve('build/jvm-src');
const JAVA_DEP_SOURCE_DIRS = [path.resolve('aster-runtime/src/main/java')];
// Exclude files that require external dependencies (Quarkus, SmallRye) not available during standalone javac
const JAVA_DEP_EXCLUSIONS = [
  /io[/\\]quarkus[/\\]runtime[/\\]graal[/\\]/, // All GraalVM substitution classes (need SmallRye/Quarkus)
  /io[/\\]aster[/\\]workflow[/\\]IdempotencyKeyManager\.java$/,       // Needs Quarkus cache
  /aster[/\\]runtime[/\\]workflow[/\\]InMemoryWorkflowRuntime\.java$/, // Depends on IdempotencyKeyManager
];
const WORKFLOW_RUNTIME_FILES = [
  path.resolve('aster-truffle/src/main/java/aster/truffle/runtime/AsyncTaskRegistry.java'),
  path.resolve('aster-truffle/src/main/java/aster/truffle/runtime/DependencyGraph.java'),
  path.resolve('aster-truffle/src/main/java/aster/truffle/runtime/WorkflowScheduler.java'),
  path.resolve('aster-truffle/src/main/java/aster/truffle/runtime/PostgresEventStore.java'),
  path.resolve('aster-truffle/src/main/java/aster/truffle/runtime/DelayedTask.java'),
  path.resolve('aster-core/src/main/java/aster/core/exceptions/MaxRetriesExceededException.java'),
];

function ensureJar(
  hasWrapper: boolean,
  jarDir: string,
  gradleTask: string,
  label: string
): void {
  const hasJar =
    fs.existsSync(jarDir) && fs.readdirSync(jarDir).some(f => f.endsWith('.jar'));
  if (hasJar) return;
  const buildCmd = hasWrapper
    ? ['./gradlew', '-g', 'build/.gradle', gradleTask]
    : ['gradle', '-g', 'build/.gradle', gradleTask];
  try {
    cp.execFileSync(buildCmd[0]!, buildCmd.slice(1), {
      stdio: 'inherit',
      env: envWithGradle(),
    });
  } catch (e) {
    console.error(`Failed to build ${label}:`, e);
    process.exit(1);
  }
  const jars = fs.readdirSync(jarDir).filter(f => f.endsWith('.jar'));
  if (jars.length === 0) {
    console.error(`${label} jar not found in`, jarDir);
    process.exit(2);
  }
}

function containsWorkflow(core: CoreIR.Module): boolean {
  return core.decls.some(
    decl => decl.kind === 'Func' && blockHasWorkflow(decl.body)
  );
}

function blockHasWorkflow(block: CoreIR.Block): boolean {
  return block.statements.some(statementHasWorkflow);
}

function statementHasWorkflow(stmt: CoreIR.Statement): boolean {
  switch (stmt.kind) {
    case 'workflow':
      return true;
    case 'Scope':
      return stmt.statements.some(statementHasWorkflow);
    case 'If':
      return (
        blockHasWorkflow(stmt.thenBlock) ||
        (stmt.elseBlock ? blockHasWorkflow(stmt.elseBlock) : false)
      );
    case 'Match':
      return stmt.cases.some(c =>
        c.body.kind === 'Return' ? false : blockHasWorkflow(c.body)
      );
    default:
      return false;
  }
}

function collectJavaSources(dir: string, exclusions: RegExp[] = []): string[] {
  if (!fs.existsSync(dir)) return [];
  const result: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        stack.push(path.join(current, entry));
      }
    } else if (current.endsWith('.java')) {
      // Skip files matching any exclusion pattern
      const excluded = exclusions.some(pattern => pattern.test(current));
      if (!excluded) {
        result.push(current);
      }
    }
  }
  return result;
}

async function compileWorkflowSources(outDir: string): Promise<void> {
  const dependencySources = JAVA_DEP_SOURCE_DIRS.flatMap(dir => collectJavaSources(dir, JAVA_DEP_EXCLUSIONS));
  const generatedSources = collectJavaSources(JVM_SRC_DIR);
  if (generatedSources.length === 0) {
    console.warn('[emit-classfiles] 未找到 workflow Java 源文件，跳过 javac。');
    return;
  }
  const workflowRuntimeSources = WORKFLOW_RUNTIME_FILES.filter(f => fs.existsSync(f));
  const javacArgs = [
    '--release',
    '25',
    '-g',
    '-d',
    outDir,
    ...dependencySources,
    ...workflowRuntimeSources,
    ...generatedSources,
  ];
  await new Promise<void>((resolve, reject) => {
    const proc = cp.spawn('javac', javacArgs, { stdio: 'inherit' });
    proc.on('error', reject);
    proc.on('close', code =>
      code === 0 ? resolve() : reject(new Error(`javac exited ${code}`))
    );
  });
}

function generateCapabilityStubs(jvmSrcDir: string): void {
  // Create aster/capabilities directory
  const capabilitiesDir = path.join(jvmSrcDir, 'aster', 'capabilities');
  fs.mkdirSync(capabilitiesDir, { recursive: true });

  // Payment capability facade
  const paymentStub = `package aster.capabilities;

/**
 * Payment capability 静态 facade（自动生成的桩实现）
 */
public final class Payment {
    private Payment() {}

    public static String charge(String orderId, Object amount) {
        return "payment-stub-" + orderId;
    }

    public static String refund(String paymentId) {
        return "refund-stub-" + paymentId;
    }
}
`;
  fs.writeFileSync(path.join(capabilitiesDir, 'Payment.java'), paymentStub);

  // Inventory capability facade
  const inventoryStub = `package aster.capabilities;

/**
 * Inventory capability 静态 facade（自动生成的桩实现）
 */
public final class Inventory {
    private Inventory() {}

    public static String reserve(String orderId, Object items) {
        return "reservation-stub-" + orderId;
    }

    public static String release(String reservationId) {
        return "released-" + reservationId;
    }
}
`;
  fs.writeFileSync(path.join(capabilitiesDir, 'Inventory.java'), inventoryStub);

  // List utility facade
  const listStub = `package aster.capabilities;

/**
 * List 工具类静态 facade（自动生成的桩实现）
 */
public final class List {
    private List() {}

    @SuppressWarnings("unchecked")
    public static <T> java.util.List<T> empty() {
        return java.util.Collections.emptyList();
    }
}
`;
  fs.writeFileSync(path.join(capabilitiesDir, 'List.java'), listStub);
}

async function emitWorkflowModules(
  modules: readonly { core: CoreIR.Module; input: string }[],
  outDir: string
): Promise<void> {
  if (modules.length === 0) return;
  console.log(
    `[emit-classfiles] 检测到 ${modules.length} 个 workflow 模块，切换到 TypeScript JVM emitter`
  );
  fs.rmSync(JVM_SRC_DIR, { recursive: true, force: true });
  fs.mkdirSync(JVM_SRC_DIR, { recursive: true });

  // Generate capability stub facades
  generateCapabilityStubs(JVM_SRC_DIR);

  for (const { core, input } of modules) {
    console.log(`[emit-classfiles] 生成 workflow Java 源码：${input}`);
    await emitJava(core, JVM_SRC_DIR);
  }
  await compileWorkflowSources(outDir);
}

async function main(): Promise<void> {
  const hasWrapper = fs.existsSync('./gradlew');
  // 确保 ASM emitter Jar 就绪（legacy 路径仍依赖）
  ensureJar(hasWrapper, 'aster-asm-emitter/build/libs', ':aster-asm-emitter:build', 'ASM emitter');

  const inputs = process.argv.slice(2);
  if (inputs.length === 0) {
    console.error('Usage: emit-classfiles <file.aster> [more.aster ...]');
    process.exit(2);
  }

  // Prefer running via Gradle run to get classpath deps available
  const runCmd = hasWrapper ? './gradlew' : 'gradle';
  // 支持通过 ASTER_CLASSES_DIR 环境变量指定隔离的类输出目录（解决并行构建竞态条件）
  const outDir = process.env.ASTER_CLASSES_DIR && process.env.ASTER_CLASSES_DIR.trim().length > 0
    ? path.resolve(process.env.ASTER_CLASSES_DIR)
    : path.resolve('build/jvm-classes');

  fs.mkdirSync(path.dirname(outDir), { recursive: true });
  // Clean output dir once to avoid stale classes
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }

  const workflowModules: { core: CoreIR.Module; input: string }[] = [];

  for (const input of inputs) {
    const src = fs.readFileSync(input, 'utf8');
    const core = lowerModule(parse(lex(canonicalize(src))).ast);
    const payload = JSON.stringify(core);
    fs.writeFileSync('build/last-core.json', payload);

    if (shouldUseFinanceDto(core.name)) {
      generateFinanceDtos(core);
    }

    if (containsWorkflow(core)) {
      workflowModules.push({ core, input });
      continue;
    }

    await new Promise<void>((resolve, reject) => {
      const proc = cp.spawn(
        runCmd,
        ['-g', 'build/.gradle', ':aster-asm-emitter:run', `--args=${outDir}`],
        {
          stdio: ['pipe', 'inherit', 'inherit'],
          env: { ...envWithGradle(), ASTER_ROOT: process.cwd() },
        }
      );
      proc.on('error', reject);
      proc.on('close', code =>
        code === 0 ? resolve() : reject(new Error(`emitter exited ${code}`))
      );
      proc.stdin.write(payload);
      proc.stdin.end();
    });
  }
  if (workflowModules.length > 0) {
    await emitWorkflowModules(workflowModules, outDir);
  }
  console.log('Emitted classes to', outDir);
}

main().catch(e => {
  console.error('emit-classfiles failed:', e);
  process.exit(1);
});
