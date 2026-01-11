#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

type Json = any;

function writeMessage(proc: ReturnType<typeof spawn>, obj: Json): void {
  const s = JSON.stringify(obj);
  proc.stdin?.write(`Content-Length: ${Buffer.byteLength(s, 'utf8')}\r\n\r\n${s}`);
}

function parseMessages(buffer: Buffer, onMessage: (m: Json) => void): Buffer {
  let buf = buffer;
  while (true) {
    const sep = buf.indexOf('\r\n\r\n');
    if (sep === -1) break;
    const header = buf.slice(0, sep).toString('utf8');
    const m = header.match(/Content-Length:\s*(\d+)/i);
    if (!m) break;
    const len = parseInt(m[1]!, 10);
    const start = sep + 4;
    if (buf.length < start + len) break;
    const body = buf.slice(start, start + len).toString('utf8');
    onMessage(JSON.parse(body));
    buf = buf.slice(start + len);
  }
  return buf;
}

async function main(): Promise<void> {
  const proc = spawn(process.execPath, ['dist/src/lsp/server.js', '--stdio'], { stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = Buffer.alloc(0) as Buffer;
  proc.stdout.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    buf = parseMessages(buf, onMessage);
  });
  const msgs: Record<number, (m: Json) => void> = {};
  function sendRequest(method: string, params: Json): Promise<Json> {
    const id = Math.floor(Math.random() * 1e6);
    writeMessage(proc, { jsonrpc: '2.0', id, method, params });
    return new Promise(resolve => {
      msgs[id] = resolve;
    });
  }
  function sendNotification(method: string, params: Json): void {
    writeMessage(proc, { jsonrpc: '2.0', method, params });
  }
  function onMessage(m: Json): void {
    if (m.id && msgs[m.id]) {
      const cb = msgs[m.id]!;
      delete msgs[m.id];
      cb(m.result);
    }
  }
  // Initialize with watched-files capability
  await sendRequest('initialize', {
    processId: process.pid,
    rootUri: null,
    capabilities: {
      workspace: { didChangeWatchedFiles: { dynamicRegistration: true } },
      textDocument: {},
    },
  });
  sendNotification('initialized', {});
  let health = await sendRequest('aster/health', {});
  const beforeFiles = (health && health.index && typeof health.index.files === 'number') ? (health.index.files as number) : 0;
  console.log('LSP health (before):', JSON.stringify(health));

  // Create a temporary CNL file and notify the server via watchedFiles
  const tmpFile = path.join(process.cwd(), 'tmp-smoke.aster');
  try { fs.writeFileSync(tmpFile, 'This module is smoke.tmp.\n\nTo id, produce Int:\n  Return 1.\n'); } catch {}
  const tmpUri = 'file://' + tmpFile;
  // FileChangeType.Created = 1
  sendNotification('workspace/didChangeWatchedFiles', { changes: [{ uri: tmpUri, type: 1 }] });
  // Give the server a moment to re-index
  await new Promise(r => setTimeout(r, 300));

  health = await sendRequest('aster/health', {});
  console.log('LSP health (after):', JSON.stringify(health));
  const afterFiles = (health && health.index && typeof health.index.files === 'number') ? (health.index.files as number) : 0;
  if (!(afterFiles > beforeFiles)) {
    console.error(`lsp-health-smoke assertion failed: index files did not increase (before=${beforeFiles}, after=${afterFiles})`);
    process.exit(1);
  }

  // Cleanup
  try { fs.unlinkSync(tmpFile); } catch {}
  // exit
  sendNotification('exit', {});
  proc.kill();
}

main().catch(e => {
  console.error('lsp-health-smoke failed:', (e as Error).message);
  process.exit(1);
});
