import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalize } from '../../src/frontend/canonicalizer.js';
import { lex } from '../../src/frontend/lexer.js';
import { parse } from '../../src/parser.js';
import { lowerModule } from '../../src/lower_to_core.js';
import { emitJava } from '../../src/jvm/emitter.js';
import type { Module as AstModule, Core as CoreTypes } from '../../src/types.js';

function parseModuleFromSource(source: string): AstModule {
  const canonical = canonicalize(source);
  const tokens = lex(canonical);
  return parse(tokens).ast;
}

function lowerCoreFromSource(source: string): CoreTypes.Module {
  const ast = parseModuleFromSource(source);
  return lowerModule(ast);
}

export function buildWorkflowSource(
  moduleName: string,
  funcName: string,
  capabilities: readonly string[],
  steps: string
): string {
  const caps = capabilities.length > 0 ? ` [${capabilities.join(', ')}]` : '';
  return `
Module ${moduleName}.

Rule ${funcName}, produce Result of Text with IO. It performs io${caps}:

  workflow:
${steps}
  .

`;
}

export async function emitWorkflowJavaFromSource(
  source: string,
  moduleName: string,
  funcName: string
): Promise<string> {
  const core = lowerCoreFromSource(source);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aster-workflow-'));
  try {
    await emitJava(core, outDir);
    const relativePath = [...moduleName.split('.'), `${funcName}_fn.java`];
    const filePath = path.join(outDir, ...relativePath);
    return fs.readFileSync(filePath, 'utf8');
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}
