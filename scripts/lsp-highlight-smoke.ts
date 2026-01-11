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
  const filePath = path.resolve('test-highlight.aster');
  if (!fs.existsSync(filePath)) {
    console.error('lsp-highlight-smoke: missing test-highlight.aster');
    process.exit(1);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const uri = pathToFileURL(filePath).href;

  const server = spawn('node', ['dist/src/lsp/server.js', '--stdio'], {
    stdio: ['pipe', 'pipe', 'inherit'],
  }) as unknown as ChildProcessWithoutNullStreams;

  const expectedRanges = new Set([
    '2:16-2:21',
    '3:14-3:19',
    '4:23-4:28',
  ]);
  const seenRanges = new Set<string>();
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
        console.error('lsp-highlight-smoke: failed to parse response', err);
        process.exit(1);
      }
      if (DEBUG) {
        console.log('←', JSON.stringify(obj));
      }
      if (obj?.id === 2) {
        const result = obj.result;
        if (!Array.isArray(result)) {
          console.error('lsp-highlight-smoke: highlight result is not an array');
          process.exit(1);
        }
        if (result.length !== expectedRanges.size) {
          console.error(
            `lsp-highlight-smoke: expected ${expectedRanges.size} highlights, got ${result.length}`
          );
          process.exit(1);
        }
        for (const h of result) {
          if (!h?.range?.start || !h?.range?.end) {
            console.error('lsp-highlight-smoke: highlight missing range');
            process.exit(1);
          }
          const key = `${h.range.start.line}:${h.range.start.character}-${h.range.end.line}:${h.range.end.character}`;
          seenRanges.add(key);
          if (typeof h.kind !== 'number' || h.kind !== 1) {
            console.error('lsp-highlight-smoke: highlight kind is not Text');
            process.exit(1);
          }
        }
        for (const want of expectedRanges) {
          if (!seenRanges.has(want)) {
            console.error('lsp-highlight-smoke: missing expected highlight range', want);
            process.exit(1);
          }
        }
        send(server, { jsonrpc: '2.0', id: 3, method: 'shutdown' });
        send(server, { jsonrpc: '2.0', method: 'exit' });
        setTimeout(() => process.exit(0), 100);
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
      method: 'textDocument/documentHighlight',
      params: {
        textDocument: { uri },
        position: { line: 4, character: 23 },
      },
    });
  }, 400);

  setTimeout(() => {
    if (seenRanges.size !== expectedRanges.size) {
      console.error('lsp-highlight-smoke: timed out waiting for highlight response');
      process.exit(1);
    }
  }, 3000);
}

main().catch(err => {
  console.error('lsp-highlight-smoke failed:', err);
  process.exit(1);
});
