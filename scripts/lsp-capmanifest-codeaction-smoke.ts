#!/usr/bin/env node
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

type Json = Record<string, any>;

function send(server: ChildProcessWithoutNullStreams, msg: Json): void {
  const payload = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n`;
  server.stdin.write(header + payload);
}

async function main(): Promise<void> {
  // Create a temp manifest that denies IO by leaving allow empty
  const outDir = 'build';
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const capsPath = path.resolve(outDir, 'tmp_caps.json');
  fs.writeFileSync(capsPath, JSON.stringify({ allow: { io: [], cpu: [] } }, null, 2) + '\n', 'utf8');

  const DEBUG = process.argv.includes('--debug');
  if (DEBUG) {
    console.log('Capability manifest path:', capsPath);
    console.log('Manifest content:', fs.readFileSync(capsPath, 'utf8'));
  }

  const server = spawn('node', ['dist/src/lsp/server.js', '--stdio'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, ASTER_CAPS: capsPath },
  }) as unknown as ChildProcessWithoutNullStreams;

  // Don't set encoding - work with raw buffers to handle byte lengths correctly
  let buffer = Buffer.alloc(0);
  let diags: any[] = [];

  server.stdout.on('data', (chunk: string | Buffer) => {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    for (;;) {
      const match = buffer.toString('utf8').match(/^Content-Length: (\d+)\r\n\r\n/);
      if (!match) break;
      const headerLen = Buffer.byteLength(match[0], 'utf8');
      const contentLen = Number(match[1]);
      if (buffer.length < headerLen + contentLen) break;
      const jsonBytes = buffer.subarray(headerLen, headerLen + contentLen);
      buffer = buffer.subarray(headerLen + contentLen);
      const jsonText = jsonBytes.toString('utf8');
      const obj = JSON.parse(jsonText);
      if (DEBUG && !obj.method?.includes('window/logMessage')) {
        if (obj.method) {
          console.log('LSP Notification/Request:', obj.method, obj.id ? `id=${obj.id}` : '', obj.params?.uri || '');
        } else if (obj.result !== undefined || obj.error) {
          console.log('LSP Response:', `id=${obj.id}`, obj.error ? 'ERROR' : 'OK');
        }
      }
      if (obj.method === 'textDocument/publishDiagnostics') {
        if (DEBUG) {
          console.log('Diagnostics URI:', obj.params?.uri, 'Count:', obj.params?.diagnostics?.length || 0);
        }
        if (obj.params?.uri === 'file:///cap-smoke.aster') {
          diags = obj.params.diagnostics || [];
          if (DEBUG) {
            console.log('Captured Diagnostics:', JSON.stringify(diags, null, 2));
          }
        }
      }
      if (obj.id === 2) {
        // Response to textDocument/diagnostic request
        const result = obj.result;
        if (result && result.items) {
          diags = result.items;
          if (DEBUG) {
            console.log('Received diagnostics:', diags.length, 'items');
            console.log('Diagnostics:', JSON.stringify(diags.map(d => ({ message: d.message, code: d.code })), null, 2));
          }
        }
      }
      if (obj.id === 3) {
        const actions: any[] = obj.result || [];
        if (DEBUG) {
          console.log('CodeActions:', JSON.stringify(actions.map(a => a.title), null, 2));
        }
        // Check for capability manifest code actions (new granular capability model)
        // Should have at least one "Allow <CAP> for <FQN>" and one "Allow <CAP> for <MODULE>.*"
        const hasAllowFqn = actions.some(a => typeof a.title === 'string' &&
          a.title.includes('for demo.capdemo.hello in manifest'));
        const hasAllowMod = actions.some(a => typeof a.title === 'string' &&
          a.title.includes('for demo.capdemo.* in manifest'));

        if (!hasAllowFqn || !hasAllowMod) {
          console.error('lsp-capmanifest-codeaction-smoke: expected allow actions not found');
          if (!DEBUG) {
            console.error('Titles:', actions.map(a => a.title));
            console.error('Diags:', diags);
          }
          process.exit(1);
        }

        // Verify we got actions for multiple capability types
        const capTypes = new Set(actions.map(a => a.title?.split(' ')[1]).filter(Boolean));
        if (capTypes.size < 2) {
          console.error('lsp-capmanifest-codeaction-smoke: expected actions for multiple capability types');
          console.error('Found capabilities:', [...capTypes]);
          process.exit(1);
        }
        // shutdown
        send(server, { jsonrpc: '2.0', id: 4, method: 'shutdown' });
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

  // Open a document that declares IO and should trigger capability violation
  const content = [
    'Module demo.capdemo.',
    '',
    'Rule hello, produce Text. It performs IO:',
    '  Return "x".',
    '',
  ].join('\n');
  send(server, {
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: {
      textDocument: { uri: 'file:///cap-smoke.aster', languageId: 'cnl', version: 1, text: content },
    },
  });

  // Request diagnostics explicitly (pull-based diagnostics in LSP 3.17+)
  setTimeout(() => {
    send(server, {
      jsonrpc: '2.0',
      id: 2,
      method: 'textDocument/diagnostic',
      params: {
        textDocument: { uri: 'file:///cap-smoke.aster' },
      },
    });
  }, 500);

  // Request code actions after diagnostics are received
  setTimeout(() => {
    if (DEBUG) {
      console.log('Requesting code actions. Diagnostics count:', diags.length);
    }
    send(server, {
      jsonrpc: '2.0',
      id: 3,
      method: 'textDocument/codeAction',
      params: {
        textDocument: { uri: 'file:///cap-smoke.aster' },
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } },
        context: { diagnostics: diags },
      },
    });
  }, 1500);
}

main().catch(e => {
  console.error('lsp-capmanifest-codeaction-smoke failed:', e);
  process.exit(1);
});
