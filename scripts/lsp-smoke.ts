#!/usr/bin/env node
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

function send(server: ChildProcessWithoutNullStreams, msg: Record<string, unknown>): void {
  const payload = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n`;
  server.stdin.write(header + payload);
}

async function main(): Promise<void> {
  const server = spawn('node', ['dist/src/lsp/server.js', '--stdio'], {
    stdio: ['pipe', 'pipe', 'inherit'],
  }) as unknown as ChildProcessWithoutNullStreams;
  let gotInitialize = false;
  server.stdout.setEncoding('utf8');
  let buffer = '';
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
      try {
        const obj = JSON.parse(jsonText);
        if (obj.id === 1) gotInitialize = true;
      } catch {
        // ignore malformed responses
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
  setTimeout(() => {
    send(server, { jsonrpc: '2.0', id: 2, method: 'shutdown' });
    send(server, { jsonrpc: '2.0', method: 'exit' });
    setTimeout(() => process.exit(gotInitialize ? 0 : 1), 200);
  }, 250);
}

main().catch(e => {
  console.error('lsp-smoke failed:', e);
  process.exit(1);
});
