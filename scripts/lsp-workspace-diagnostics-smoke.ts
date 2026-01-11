#!/usr/bin/env node
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

function send(server: ChildProcessWithoutNullStreams, msg: Record<string, unknown>): void {
  const payload = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n`;
  server.stdin.write(header + payload);
}

async function readOne(server: ChildProcessWithoutNullStreams, id: number, timeoutMs = 5000): Promise<any> {
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
        try {
          const obj = JSON.parse(jsonText);
          if (obj.id === id) {
            server.stdout.off('data', onData);
            clearTimeout(to);
            resolve(obj);
            return;
          }
          // Continue processing other messages (notifications, etc.)
        } catch {
          // ignore parse errors and continue
        }
      }
    };
    const to = setTimeout((): void => {
      server.stdout.off('data', onData);
      reject(new Error('timeout waiting for response'));
    }, timeoutMs);
    server.stdout.on('data', onData);
  });
}

async function main(): Promise<void> {
  const server = spawn('node', ['dist/src/lsp/server.js', '--stdio'], { stdio: ['pipe', 'pipe', 'inherit'] }) as unknown as ChildProcessWithoutNullStreams;
  server.stdout.setEncoding('utf8');
  // initialize
  send(server, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } });
  await readOne(server, 1);
  send(server, { jsonrpc: '2.0', method: 'initialized', params: {} });

  // request workspace diagnostics (enabled by default)
  send(server, { jsonrpc: '2.0', id: 2, method: 'workspace/diagnostic', params: { previousResultIds: [] } });
  const diagResp1 = await readOne(server, 2);
  if (!diagResp1 || !diagResp1.result || !Array.isArray(diagResp1.result.items)) throw new Error('workspace diagnostics response invalid');

  // disable via didChangeConfiguration and expect empty items
  send(server, {
    jsonrpc: '2.0',
    method: 'workspace/didChangeConfiguration',
    params: { settings: { asterLanguageServer: { diagnostics: { workspace: false } } } },
  });
  // give server a moment to apply config
  await new Promise(r => setTimeout(r, 100));
  send(server, { jsonrpc: '2.0', id: 3, method: 'workspace/diagnostic', params: { previousResultIds: [] } });
  const diagResp2 = await readOne(server, 3);
  if (!diagResp2 || !diagResp2.result || !Array.isArray(diagResp2.result.items)) throw new Error('workspace diagnostics (disabled) invalid');
  if (diagResp2.result.items.length !== 0) throw new Error('workspace diagnostics not disabled by setting');

  // shutdown
  send(server, { jsonrpc: '2.0', id: 4, method: 'shutdown' });
  await readOne(server, 4).catch(() => {});
  send(server, { jsonrpc: '2.0', method: 'exit' });
  setTimeout(() => process.exit(0), 50);
}

main().catch(e => {
  console.error('lsp-workspace-diagnostics-smoke failed:', (e as Error).message);
  process.exit(1);
});
