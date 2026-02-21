#!/usr/bin/env node
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

type Json = Record<string, any>;
function send(server: ChildProcessWithoutNullStreams, msg: Json): void {
  const payload = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n`;
  server.stdin.write(header + payload);
}
async function read(server: ChildProcessWithoutNullStreams, id: number, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: string | Buffer): void => {
      buffer += String(chunk);
      for (;;) {
        const m = buffer.match(/^Content-Length: (\d+)\r\n\r\n/);
        if (!m) break;
        const len = Number(m[1]);
        const start = m[0].length;
        if (buffer.length < start + len) break;
        const jsonText = buffer.slice(start, start + len);
        buffer = buffer.slice(start + len);
        const obj = JSON.parse(jsonText);
        if (obj.id === id) {
          clearTimeout(to);
          server.stdout.off('data', onData);
          resolve(obj);
          return;
        }
      }
    };
    const to = setTimeout(() => { server.stdout.off('data', onData); reject(new Error('timeout')); }, timeoutMs);
    server.stdout.on('data', onData);
  });
}

async function main(): Promise<void> {
  const server = spawn('node', ['dist/src/lsp/server.js', '--stdio'], { stdio: ['pipe', 'pipe', 'inherit'] }) as unknown as ChildProcessWithoutNullStreams;
  server.stdout.setEncoding('utf8');
  // init
  send(server, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } });
  await read(server, 1);
  send(server, { jsonrpc: '2.0', method: 'initialized', params: {} });

  const path = await import('node:path');
  const url = await import('node:url');
  const fs = await import('node:fs');
  const aFs = path.join(process.cwd(), 'test', 'lsp-multi', 'a.aster');
  const bFs = path.join(process.cwd(), 'test', 'lsp-multi', 'b.aster');
  const aUri = String(url.pathToFileURL(aFs));
  const bUri = String(url.pathToFileURL(bFs));
  const aText = fs.readFileSync(aFs, 'utf8');
  const bText = fs.readFileSync(bFs, 'utf8');
  // open both docs
  send(server, { jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri: aUri, languageId: 'cnl', version: 1, text: aText } } });
  send(server, { jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri: bUri, languageId: 'cnl', version: 1, text: bText } } });

  // rename 'greet' to 'greet2' at its declaration in a.aster
  const lines = aText.split(/\n/);
  const lineIdx = lines.findIndex(l => /Rule\s+greet\b/.test(l));
  const charIdx = Math.max(0, lines[lineIdx]!.indexOf('greet'));
  send(server, { jsonrpc: '2.0', id: 2, method: 'textDocument/rename', params: { textDocument: { uri: aUri }, position: { line: lineIdx, character: charIdx + 2 }, newName: 'greet2' } });
  const resp = await read(server, 2);
  const changes = resp?.result?.changes as Record<string, any[]> | undefined;
  if (!changes) throw new Error('No changes returned from rename');
  const aEdits = changes[aUri] || [];
  const bEdits = changes[bUri] || [];
  if (aEdits.length === 0) throw new Error('No edits in declaration file');
  if (bEdits.length === 0) throw new Error('No edits in reference file');
  // Check at least one edit in b replaces dotted reference
  const dottedChanged = bEdits.some(e => typeof e.newText === 'string' && e.newText.includes('greet2'));
  if (!dottedChanged) throw new Error('Dotted reference not updated');

  // shutdown
  send(server, { jsonrpc: '2.0', id: 3, method: 'shutdown' });
  await read(server, 3).catch(() => {});
  send(server, { jsonrpc: '2.0', method: 'exit' });
  setTimeout(() => process.exit(0), 50);
}

main().catch(e => { console.error('lsp-multi-rename.test failed:', (e as Error).message); process.exit(1); });
