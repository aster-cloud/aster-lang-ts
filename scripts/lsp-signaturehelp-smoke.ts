#!/usr/bin/env node
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type Json = Record<string, any>;

function send(server: ChildProcessWithoutNullStreams, msg: Json): void {
  const payload = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n`;
  server.stdin.write(header + payload);
}

async function main(): Promise<void> {
  const filePath = path.resolve('test-signature-help.aster');
  if (!fs.existsSync(filePath)) {
    console.error('lsp-signaturehelp-smoke: missing test-signature-help.aster');
    process.exit(1);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const uri = pathToFileURL(filePath).href;

  const server = spawn('node', ['dist/src/lsp/server.js', '--stdio'], {
    stdio: ['pipe', 'pipe', 'inherit'],
  }) as unknown as ChildProcessWithoutNullStreams;

  const expected = new Map<number, number>([
    [2, 0],
    [3, 1],
  ]);
  const seen = new Set<number>();
  const DEBUG = process.argv.includes('--debug');

  let buffer = '';
  server.stdout.setEncoding('utf8');
  server.stdout.on('data', chunk => {
    buffer += String(chunk);
    for (;;) {
      const match = buffer.match(/^Content-Length: (\d+)\r\n\r\n/);
      if (!match) break;
      const len = Number(match[1]);
      const start = match[0].length;
      if (buffer.length < start + len) break;
      const jsonText = buffer.slice(start, start + len);
      buffer = buffer.slice(start + len);
      let obj: any;
      try {
        obj = JSON.parse(jsonText);
      } catch (err) {
        console.error('lsp-signaturehelp-smoke: failed to parse response', err);
        process.exit(1);
      }
      if (DEBUG) {
        console.log('←', JSON.stringify(obj));
      }
      if (typeof obj.id === 'number' && expected.has(obj.id)) {
        const want = expected.get(obj.id)!;
        const result = obj.result;
        if (!result || !Array.isArray(result.signatures) || result.signatures.length === 0) {
          console.error(`lsp-signaturehelp-smoke: empty signature result for request ${obj.id}`);
          process.exit(1);
        }
        const sig = result.signatures[0];
        if (typeof sig.label !== 'string' || !sig.label.includes('add(')) {
          console.error(`lsp-signaturehelp-smoke: unexpected signature label for request ${obj.id}:`, sig.label);
          process.exit(1);
        }
        if (!Array.isArray(sig.parameters) || sig.parameters.length < 2) {
          console.error(`lsp-signaturehelp-smoke: missing parameters for request ${obj.id}`);
          process.exit(1);
        }
        if (typeof result.activeParameter !== 'number' || result.activeParameter !== want) {
          console.error(`lsp-signaturehelp-smoke: expected activeParameter ${want} for request ${obj.id}, got ${result.activeParameter}`);
          process.exit(1);
        }
        seen.add(obj.id);
        if (seen.size === expected.size) {
          send(server, { jsonrpc: '2.0', id: 4, method: 'shutdown' });
          send(server, { jsonrpc: '2.0', method: 'exit' });
          setTimeout(() => process.exit(0), 100);
        }
      }
    }
  });

  send(server, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { processId: null, rootUri: null, capabilities: {} },
  });
  send(server, { jsonrpc: '2.0', method: 'initialized', params: {} });

  send(server, {
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: {
      textDocument: { uri, languageId: 'cnl', version: 1, text: content },
    },
  });

  setTimeout(() => {
    send(server, {
      jsonrpc: '2.0',
      id: 2,
      method: 'textDocument/signatureHelp',
      params: {
        textDocument: { uri },
        position: { line: 6, character: 20 },
      },
    });
    setTimeout(() => {
      send(server, {
        jsonrpc: '2.0',
        id: 3,
        method: 'textDocument/signatureHelp',
        params: {
          textDocument: { uri },
          position: { line: 6, character: 23 },
        },
      });
    }, 150);
  }, 400);

  setTimeout(() => {
    if (seen.size !== expected.size) {
      console.error('lsp-signaturehelp-smoke: timed out waiting for signature help responses');
      process.exit(1);
    }
  }, 3000);
}

main().catch(err => {
  console.error('lsp-signaturehelp-smoke failed:', err);
  process.exit(1);
});
