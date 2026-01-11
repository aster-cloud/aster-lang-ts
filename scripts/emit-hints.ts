#!/usr/bin/env node
import fs from 'node:fs';

type Core = any;

function classifyExpr(e: any, env: Record<string,'I'|'J'|'D'>): 'I'|'J'|'D'|null {
  if (!e) return null;
  switch (e.kind) {
    case 'Int': return 'I';
    case 'Long': return 'J';
    case 'Double': return 'D';
    case 'Bool': return 'I';
    case 'Name': return env[e.name] ?? null;
    case 'Call': {
      const t = e.target;
      if (t?.kind === 'Name') {
        const n = t.name;
        if (n === '+' || n === '-' || n === 'times' || n === 'divided by') {
          const k0 = classifyExpr(e.args?.[0], env);
          const k1 = classifyExpr(e.args?.[1], env);
          if (k0 && k1) return (k0 === 'D' || k1 === 'D') ? 'D' : (k0 === 'J' || k1 === 'J') ? 'J' : 'I';
        }
      }
      return null;
    }
    default:
      return null;
  }
}

function analyze(core: Core): Record<string, Record<string, 'I'|'J'|'D'>> {
  const out: Record<string, Record<string, 'I'|'J'|'D'>> = {};
  const mod = core;
  const mname: string = mod.name || 'app';
  for (const d of mod.decls || []) {
    if (d.kind !== 'Func') continue;
    const fname = `${mname}.${d.name}`;
    const vars: Record<string, 'I'|'J'|'D'> = {};
    // seed from params
    for (const p of d.params || []) {
      if (p.type?.kind === 'TypeName') {
        if (p.type.name === 'Int' || p.type.name === 'Bool') vars[p.name] = 'I';
        else if (p.type.name === 'Long') vars[p.name] = 'J';
        else if (p.type.name === 'Double') vars[p.name] = 'D';
      }
    }
    for (const s of d.body?.statements || []) {
      if (s.kind === 'Let') {
        const tag = classifyExpr(s.expr, vars);
        if (tag) vars[s.name] = tag;
      }
    }
    out[fname] = vars;
  }
  return out;
}

function main(): void {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: emit-hints <file.core.json>');
    process.exit(2);
  }
  const core = JSON.parse(fs.readFileSync(input, 'utf8'));
  const hints = analyze(core);
  const result = { functions: hints };
  fs.mkdirSync('build', { recursive: true });
  const out = 'build/hints.json';
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log('Wrote hints to', out);
}

main();
