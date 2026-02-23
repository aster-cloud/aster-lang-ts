#!/usr/bin/env node
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

type Json = Record<string, any>;

function send(server: ChildProcessWithoutNullStreams, msg: Json): void {
  const payload = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n`;
  server.stdin.write(header + payload);
}

async function read(server: ChildProcessWithoutNullStreams, matchId?: number, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const bufferStr = buffer.toString('utf8');
        const m = bufferStr.match(/^Content-Length: (\d+)\r\n\r\n/);
        if (!m) break;
        const len = Number(m[1]);
        const headerLen = Buffer.byteLength(m[0], 'utf8');
        if (buffer.length < headerLen + len) break;
        const jsonBuffer = buffer.subarray(headerLen, headerLen + len);
        buffer = buffer.subarray(headerLen + len);
        const jsonText = jsonBuffer.toString('utf8');
        const obj = JSON.parse(jsonText);
        if (matchId === undefined || obj.id === matchId) {
          server.stdout.off('data', onData);
          clearTimeout(to);
          resolve(obj);
          return;
        }
      }
    };
    const to = setTimeout((): void => {
      server.stdout.off('data', onData);
      reject(new Error('timeout'));
    }, timeoutMs);
    server.stdout.on('data', onData);
  });
}

async function main(): Promise<void> {
  const server = spawn('node', ['dist/src/lsp/server.js', '--stdio'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env },
  }) as unknown as ChildProcessWithoutNullStreams;

  // initialize
  send(server, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } });
  await read(server, 1);
  send(server, { jsonrpc: '2.0', method: 'initialized', params: {} });

  // Open a document with no module header
  const content = ['Rule hello, produce Text:', '  Return "x".', ''].join('\n');
  const uri = 'file:///missing-header.aster';
  send(server, { jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'cnl', version: 1, text: content } } });

  // Pull diagnostics for the document
  send(server, { jsonrpc: '2.0', id: 2, method: 'textDocument/diagnostic', params: { textDocument: { uri } } });
  const diagResp = await read(server, 2);
  const items = diagResp?.result?.items ?? [];
  // Request code actions with pulled diagnostics
  send(server, { jsonrpc: '2.0', id: 3, method: 'textDocument/codeAction', params: { textDocument: { uri }, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, context: { diagnostics: items } } });
  const actResp = await read(server, 3);
  const actions: any[] = actResp?.result ?? [];
  const ok = actions.some(a => typeof a.title === 'string' && a.title.startsWith('Fix: Add module header'));
  if (!ok) {
    console.error('missing-header-codeaction-smoke: expected module header quick-fix');
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
  console.error('lsp-missing-header-codeaction-smoke failed:', (e as Error).message);
  process.exit(1);
});

