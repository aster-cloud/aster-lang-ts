import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

type PendingCallback = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

/** 可复用的 LSP stdio 客户端，复用裸协议能力 */
export class LSPClient {
  private server: ChildProcessWithoutNullStreams | null = null;
  private messageId = 0;
  private buffer = Buffer.alloc(0); // Use Buffer instead of string to handle UTF-8 byte lengths correctly
  private pendingRequests = new Map<number, PendingCallback>();
  private pendingMessages: unknown[] = [];
  private pendingReceivers: PendingCallback[] = [];
  private closed = false;

  /** 启动 LSP 服务器进程 */
  spawn(serverPath: string): void {
    if (this.server) throw new Error('LSP 服务已在运行');

    this.resetState();
    const server = spawn('node', [serverPath, '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as unknown as ChildProcessWithoutNullStreams;

    // 配置 stdout 缓冲区大小为 100KB，支持大型 JSON 响应（如 workspace/diagnostic）
    if (server.stdout.readableHighWaterMark < 100 * 1024) {
      // @ts-expect-error - Node.js internal API to increase buffer size
      server.stdout._readableState.highWaterMark = 100 * 1024;
    }
    // Don't set encoding - we need raw Buffer to correctly handle UTF-8 byte lengths
    server.stdout.on('data', chunk => {
      this.handleStdout(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
    });
    server.stderr.on('data', chunk => {
      console.error('[LSP stderr]', String(chunk));
    });
    server.on('error', err => {
      this.failAll(new Error(`LSP 进程异常：${err.message}`));
    });
    server.on('exit', (code, signal) => {
      const reason = code !== null ? `退出码 ${code}` : `信号 ${signal ?? 'unknown'}`;
      this.failAll(new Error(`LSP 进程已退出：${reason}`));
    });

    this.server = server;
  }

  /** 发送 JSON-RPC 消息 */
  private send(msg: Record<string, unknown>): void {
    const server = this.ensureServer();
    const payload = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n`;
    server.stdin.write(header + payload);
  }

  /** 接收下一条原始消息（包括服务器通知） */
  async recv(): Promise<unknown> {
    if (this.pendingMessages.length) return this.pendingMessages.shift();
    if (this.closed) throw new Error('LSP 客户端已关闭');
    return new Promise((resolve, reject) => {
      this.pendingReceivers.push({ resolve, reject });
    });
  }

  /** 发送请求并等待响应结果 */
  async request(method: string, params?: unknown): Promise<unknown> {
    const id = ++this.messageId;
    const message: Record<string, unknown> = { jsonrpc: '2.0', id, method };
    if (params !== undefined) message.params = params;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      try {
        this.send(message);
      } catch (err) {
        this.pendingRequests.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** 发送通知（无响应） */
  notify(method: string, params?: unknown): void {
    const message: Record<string, unknown> = { jsonrpc: '2.0', method };
    if (params !== undefined) message.params = params;
    this.send(message);
  }

  /** 关闭客户端并终止进程 */
  close(): void {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    server.stdout.removeAllListeners('data');
    server.stderr.removeAllListeners('data');
    server.removeAllListeners('error');
    server.removeAllListeners('exit');
    this.failAll(new Error('LSP 客户端已关闭'));
    server.kill();
  }

  /** 清除状态以复用 */
  private resetState(): void {
    this.messageId = 0;
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    this.pendingRequests.clear();
    this.pendingMessages = [];
    this.pendingReceivers = [];
  }

  private ensureServer(): ChildProcessWithoutNullStreams {
    if (!this.server) throw new Error('LSP 服务未启动');
    return this.server;
  }

  private handleStdout(chunk: Buffer): void {
    // Concatenate new chunk to existing buffer
    this.buffer = Buffer.concat([this.buffer, chunk]);

    for (;;) {
      // Parse header from buffer (ASCII safe)
      const bufferStr = this.buffer.toString('utf8');
      const headerMatch = bufferStr.match(/^Content-Length: (\d+)\r\n\r\n/);
      if (!headerMatch) break;

      const contentLength = Number(headerMatch[1]);
      const headerLength = Buffer.byteLength(headerMatch[0], 'utf8');

      // Check if we have enough bytes for the full message
      if (this.buffer.length < headerLength + contentLength) break;

      // Extract payload using byte offsets (not string indices!)
      const payloadBuffer = this.buffer.slice(headerLength, headerLength + contentLength);
      const payload = payloadBuffer.toString('utf8');
      this.buffer = this.buffer.slice(headerLength + contentLength);

      try {
        const message = JSON.parse(payload);
        this.dispatchMessage(message);
      } catch (err) {
        // Fallback: try to find valid JSON by looking for last }
        const candidateEnd = payload.lastIndexOf('}');
        if (candidateEnd >= 0) {
          const candidate = payload.slice(0, candidateEnd + 1);
          try {
            const message = JSON.parse(candidate);
            this.dispatchMessage(message);
            continue;
          } catch (nestedErr) {
            console.error('解析 LSP 消息失败：', nestedErr);
            console.error('原始消息 (truncated):', payload.slice(0, 500));
          }
        } else {
          console.error('解析 LSP 消息失败：', err);
          console.error('原始消息 (truncated):', payload.slice(0, 500));
        }
      }
    }
  }

  private dispatchMessage(message: any): void {
    if (message && Object.prototype.hasOwnProperty.call(message, 'id')) {
      const pending = this.pendingRequests.get(message.id as number);
      if (pending) {
        this.pendingRequests.delete(message.id as number);
        if (message.error) {
          const error = new Error(
            typeof message.error.message === 'string' ? message.error.message : 'LSP 请求失败',
          );
          (error as any).code = message.error.code;
          (error as any).data = message.error.data;
          pending.reject(error);
        } else {
          pending.resolve(message.result);
        }
        return;
      }
    }
    this.pendingMessages.push(message);
    this.flushReceivers();
  }

  private flushReceivers(): void {
    while (this.pendingMessages.length && this.pendingReceivers.length) {
      const nextMessage = this.pendingMessages.shift();
      const receiver = this.pendingReceivers.shift();
      receiver?.resolve(nextMessage);
    }
  }

  private failAll(error: Error): void {
    if (this.closed) return;
    this.closed = true;

    for (const pending of this.pendingRequests.values()) pending.reject(error);
    this.pendingRequests.clear();

    for (const receiver of this.pendingReceivers) receiver.reject(error);
    this.pendingReceivers = [];

    this.pendingMessages = [];
  }
}
