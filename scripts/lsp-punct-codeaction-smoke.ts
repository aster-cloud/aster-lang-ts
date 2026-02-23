#!/usr/bin/env node
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

type Json = Record<string, any>;

function send(server: ChildProcessWithoutNullStreams, msg: Json): void {
  const payload = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n`;
  server.stdin.write(header + payload);
}

async function read(server: ChildProcessWithoutNullStreams, id: number, timeoutMs = 2000): Promise<any> {
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

  // Document with a missing colon at end of header line
  const content = ['Module demo.p.', 'Rule f, produce Text', '  Return "x"', ''].join('\n');
  const uri = 'file:///punct-smoke.aster';
  send(server, { jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'cnl', version: 1, text: content } } });
  // Pull diagnostics
  send(server, { jsonrpc: '2.0', id: 2, method: 'textDocument/diagnostic', params: { textDocument: { uri } } });
  const diagResp = await read(server, 2);
  const items = diagResp?.result?.items ?? [];
  // Request code actions; we expect an add ':' or '.' quick-fix
  send(server, { jsonrpc: '2.0', id: 3, method: 'textDocument/codeAction', params: { textDocument: { uri }, range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }, context: { diagnostics: items } } });
  const actResp = await read(server, 3);
  const actions: any[] = actResp?.result ?? [];
  const hasPunct = actions.some(a => typeof a.title === 'string' && /Fix: add '[:\.]' at end of line/.test(a.title));
  if (!hasPunct) {
    console.error('punct-codeaction-smoke: expected punctuation quick-fix');
    console.error('Titles:', actions.map(a => a.title));
    process.exit(1);
  }
  // shutdown
  send(server, { jsonrpc: '2.0', id: 4, method: 'shutdown' });
  await read(server, 4).catch(() => {});
  send(server, { jsonrpc: '2.0', method: 'exit' });
  setTimeout(() => process.exit(0), 50);
}

main().catch(e => {
  console.error('lsp-punct-codeaction-smoke failed:', (e as Error).message);
  process.exit(1);
});

