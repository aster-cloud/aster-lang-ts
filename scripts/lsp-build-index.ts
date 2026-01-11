#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { canonicalize } from '../src/frontend/canonicalizer.js';
import { lex } from '../src/frontend/lexer.js';
import { parse } from '../src/parser.js';
import type { Module as AstModule, Declaration as AstDecl, Span } from '../src/types.js';

type IndexedDecl = { name: string; kind: 'Func' | 'Data' | 'Enum'; span?: Span; nameSpan?: Span };
type IndexedDoc = { uri: string; moduleName: string | null; decls: IndexedDecl[] };
type IndexFile = { version: number; generatedAt: string; root: string; files: IndexedDoc[] };

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.endsWith('.aster')) out.push(p);
  }
  return out;
}

function indexFile(file: string): IndexedDoc | null {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const can = canonicalize(text);
    const tokens = lex(can);
    const ast = parse(tokens) as AstModule;
    const decls: IndexedDecl[] = [];
    for (const d of ast.decls as AstDecl[]) {
      if (d.kind === 'Func' || d.kind === 'Data' || d.kind === 'Enum') {
        decls.push({ name: (d as any).name, kind: d.kind as any, span: (d as any).span, nameSpan: (d as any).nameSpan });
      }
    }
    return { uri: file, moduleName: ast.name ?? null, decls };
  } catch {
    return null;
  }
}

function main(): void {
  const root = process.cwd();
  const cnlDir = path.join(root, 'cnl');
  const files = fs.existsSync(cnlDir) ? walk(cnlDir) : [];
  const indexed: IndexedDoc[] = [];
  for (const f of files) {
    const rec = indexFile(f);
    if (rec) indexed.push(rec);
  }
  const out: IndexFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    root,
    files: indexed,
  };
  const outDir = path.join(root, '.asteri');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'lsp-index.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`Indexed ${indexed.length} files → ${path.relative(root, outPath)}`);
}

main();

