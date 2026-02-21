#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFile(p: string, content: string): void {
  fs.writeFileSync(p, content, { encoding: 'utf8', flag: 'wx' });
}

function main(): void {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node --loader ts-node/esm scripts/scaffold.ts <dir>');
    process.exit(2);
  }

  const root = path.resolve(process.cwd(), target);
  const cnlDir = path.join(root, 'cnl');
  const readme = path.join(root, 'README.md');
  const mainCnl = path.join(cnlDir, 'main.aster');

  if (fs.existsSync(root)) {
    console.error('Refusing to overwrite existing directory:', root);
    process.exit(3);
  }

  ensureDir(cnlDir);

  const cnl = `Module app.

Define a User has id: Text and name: Text.

Rule hello, produce Text:
  Return "Hello, world".

Rule greet user: maybe User, produce Text:
  Match user:
    When null, Return "Hi, guest".
    When User(id, name), Return "Welcome, {name}".
`;

  const guide = `# Aster Project Scaffold

This folder was created by Aster's scaffold tool. It contains a minimal CNL program at \`test/cnl/main.aster\`.

## Files

- \`test/cnl/main.aster\` — demo module with \`hello\` and \`greet\`.

## Try It (from aster-lang repo root)

1) Build the compiler once:

   npm run build

2) Parse to AST:

   node dist/scripts/cli.js ${path.relative(process.cwd(), mainCnl)}

3) Emit Core IR:

   node dist/scripts/emit-core.js ${path.relative(process.cwd(), mainCnl)}

4) Emit JVM class files and create a jar:

   node dist/scripts/emit-classfiles.js ${path.relative(process.cwd(), mainCnl)}
   node --loader ts-node/esm scripts/jar-jvm.ts

The generated jar is written to \`build/aster-out/aster.jar\`. You can attach it to the example Gradle apps under \`examples/*\` (they already depend on that jar).

`;

  writeFile(mainCnl, cnl);
  writeFile(readme, guide);

  console.log('Scaffolded Aster project at', root);
  console.log('Next: open', path.relative(process.cwd(), mainCnl));
}

main();
