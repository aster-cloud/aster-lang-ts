#!/usr/bin/env node
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

type Json = Record<string, any>;
function send(server: ChildProcessWithoutNullStreams, msg: Json): void {
  const payload = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n`;
  server.stdin.write(header + payload);
}

async function readUntil(server: ChildProcessWithoutNullStreams, predicate: (obj: any) => boolean, timeoutMs = 3000): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const out: any[] = [];
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
        try {
          const obj = JSON.parse(jsonText);
          out.push(obj);
          if (predicate(obj)) {
            cleanup();
            resolve(out);
            return;
          }
        } catch {
          // Ignore parse errors and continue processing
        }
      }
    };
    const to = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, timeoutMs);
    const cleanup = (): void => { clearTimeout(to); server.stdout.off('data', onData); };
    server.stdout.on('data', onData);
  });
}

async function main(): Promise<void> {
  const server = spawn('node', ['dist/src/lsp/server.js', '--stdio'], { stdio: ['pipe', 'pipe', 'inherit'] }) as unknown as ChildProcessWithoutNullStreams;
  server.stdout.setEncoding('utf8');

  // initialize
  send(server, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } });
  await readUntil(server, o => o.id === 1);
  send(server, { jsonrpc: '2.0', method: 'initialized', params: {} });

  // configure small chunk size
  send(server, { jsonrpc: '2.0', method: 'workspace/didChangeConfiguration', params: { settings: { asterLanguageServer: { streaming: { referencesChunk: 1, logChunks: true } } } } });

  // open a document with many occurrences of the same word to trigger multiple chunks
  const uri = 'file:///streaming.aster';
  const many = 'greet '.repeat(20).trim();
  const text = `This module is streaming.test.\n\nTo greet, produce Text:\n  Return "x".\n\n# refs below\n${many}\n`;
  send(server, { jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'cnl', version: 1, text } } });

  // collect notifications as we send the request; expect multiple progress chunks
  let chunks = 0;
  await new Promise<void>((resolve, reject) => {
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
        try {
          const obj = JSON.parse(jsonText);
          if (obj.method === '$/progress' && (obj.params?.token === 'pr1' || obj.params?.token === 'wd1')) {
            const v = obj.params?.value;
            if (v && typeof v.message === 'string' && v.message.startsWith('references: +')) {
              chunks++;
              if (chunks >= 2) { cleanup(); resolve(); return; }
            }
          }
          if (obj.method === 'window/logMessage' && typeof obj.params?.message === 'string' && obj.params.message.startsWith('references chunk: +')) {
            chunks++;
            if (chunks >= 2) { cleanup(); resolve(); return; }
          }
          if (obj.id === 2) { /* response; ignore */ }
        } catch {
          // Ignore parse errors and continue processing
        }
      }
    };
    const to = setTimeout(() => { cleanup(); reject(new Error('no multiple chunks observed')); }, 5000);
    const cleanup = (): void => { clearTimeout(to); server.stdout.off('data', onData); };
    server.stdout.on('data', onData);
    // issue references with workDone and partial result tokens
    const lineIdx = text.split(/\n/).findIndex(l => /To\s+greet\b/.test(l));
    const charIdx = Math.max(0, (text.split(/\n/)[lineIdx] || '').indexOf('greet')) + 1;
    send(server, { jsonrpc: '2.0', id: 2, method: 'textDocument/references', params: { textDocument: { uri }, position: { line: lineIdx, character: charIdx }, context: { includeDeclaration: true }, workDoneToken: 'wd1', partialResultToken: 'pr1' } });
  });

  // shutdown
  send(server, { jsonrpc: '2.0', id: 3, method: 'shutdown' });
  await readUntil(server, o => o.id === 3).catch(() => {});
  send(server, { jsonrpc: '2.0', method: 'exit' });
  setTimeout(() => process.exit(0), 50);
}

main().catch(e => { console.error('lsp-streaming-progress-smoke failed:', (e as Error).message); process.exit(1); });
