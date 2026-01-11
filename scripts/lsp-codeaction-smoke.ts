#!/usr/bin/env node
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

type Json = Record<string, any>;

function send(server: ChildProcessWithoutNullStreams, msg: Json): void {
  const payload = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n`;
  server.stdin.write(header + payload);
}

async function main(): Promise<void> {
  const server = spawn('node', ['dist/src/lsp/server.js', '--stdio'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env },
  }) as unknown as ChildProcessWithoutNullStreams;

  server.stdout.setEncoding('utf8');
  let buffer = '';
  // no-op
  let diags: any[] = [];

  const DEBUG = process.argv.includes('--debug');
  server.stdout.on('data', (chunk: string | Buffer) => {
    buffer += String(chunk);
    for (;;) {
      const match = buffer.match(/^Content-Length: (\d+)\r\n\r\n/);
      if (!match) break;
      const len = Number(match[1]);
      const start = match[0].length;
      if (buffer.length < start + len) break;
      const jsonText = buffer.slice(start, start + len);
      buffer = buffer.slice(start + len);
      const obj = JSON.parse(jsonText);
      // initialized response received
      if (obj.method === 'textDocument/publishDiagnostics') {
        if (obj.params?.uri === 'file:///cap-smoke.aster') {
          diags = obj.params.diagnostics || [];
        }
      }
      if (obj.id === 2) {
        // codeAction response
        const actions: any[] = obj.result || [];
        if (DEBUG) console.log('CodeActions:', JSON.stringify(actions.map(a => a.title), null, 2));
        const hasAddIO = actions.some(a => typeof a.title === 'string' && a.title.startsWith('Add It performs IO'));
        if (!hasAddIO) {
          console.error('lsp-codeaction-smoke: did not find Add It performs IO quick-fix');
          if (!DEBUG) console.error('Titles:', actions.map(a => a.title));
          process.exit(1);
        }
        // shutdown
        send(server, { jsonrpc: '2.0', id: 3, method: 'shutdown' });
        send(server, { jsonrpc: '2.0', method: 'exit' });
        setTimeout(() => process.exit(0), 100);
      }
    }
  });

  // Initialize
  send(server, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { processId: null, rootUri: null, capabilities: {} },
  });
  send(server, { jsonrpc: '2.0', method: 'initialized', params: {} });

  // Open a document with missing IO effect but IO-like call
  const content = [
    'This module is demo.capdemo.',
    '',
    'To hello, produce Text:',
    '  Return UUID.randomUUID().',
    '',
  ].join('\n');
  send(server, {
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: {
      textDocument: { uri: 'file:///cap-smoke.aster', languageId: 'cnl', version: 1, text: content },
    },
  });

  // Wait a moment for diagnostics
  setTimeout(() => {
    // Request code actions with the diagnostics we captured
    send(server, {
      jsonrpc: '2.0',
      id: 2,
      method: 'textDocument/codeAction',
      params: {
        textDocument: { uri: 'file:///cap-smoke.aster' },
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } },
        context: { diagnostics: diags },
      },
    });
  }, 300);
}

main().catch(e => {
  console.error('lsp-codeaction-smoke failed:', e);
  process.exit(1);
});
