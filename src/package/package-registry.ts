/**
 * GitHub Releases API 交互层
 *
 * 提供包版本列表查询、tarball 下载与 rate limit 状态获取能力。
 */

import { createRequire } from 'node:module';
import type { IncomingHttpHeaders } from 'node:http';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdtemp, rename, rm, readdir, stat, copyFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseVersion } from './version-utils.js';
import {
  type Diagnostic,
  DiagnosticCode,
  DiagnosticBuilder,
  dummyPosition,
} from '../diagnostics/diagnostics.js';

const nodeRequire = createRequire(import.meta.url);
const https: typeof import('node:https') = nodeRequire('node:https');

const DEFAULT_BASE_URL = 'https://api.github.com';
const DEFAULT_TIMEOUT = 30_000;
const USER_AGENT = 'aster-lang-package-registry';
const MAX_REDIRECTS = 4;
const RELEASES_PATH = '/repos/aster-lang/packages/releases';

interface GitHubAsset {
  readonly name: string;
  readonly browser_download_url: string;
  readonly size?: number;
}

interface GitHubRelease {
  readonly tag_name: string;
  readonly assets?: GitHubAsset[];
}

interface RateApiResponse {
  readonly rate?: {
    readonly limit?: number;
    readonly remaining?: number;
    readonly reset?: number;
  };
}

interface JsonResponse<T> {
  readonly data: T;
  readonly headers: IncomingHttpHeaders;
}

type RegistryMode = 'remote' | 'local';

function buildHttpDiagnostics(
  code: DiagnosticCode,
  message: string
): Diagnostic[] {
  return [
    DiagnosticBuilder.error(code)
      .withMessage(message)
      .withPosition(dummyPosition())
      .build()
  ];
}

export interface RegistryConfig {
  githubToken?: string;
  timeout?: number;
  baseUrl?: string;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
}

/**
 * 基于 GitHub Releases 的包注册中心客户端
 */
export class PackageRegistry {
  private readonly baseUrl: URL;
  private readonly baseOrigin: string;
  private readonly timeout: number;
  private readonly githubToken: string | undefined;
  private readonly mode: RegistryMode;
  private readonly localRegistryDir?: string;

  constructor(config: RegistryConfig = {}) {
    const rawBase = config.baseUrl?.trim();
    if (rawBase && this.shouldUseLocalRegistry(rawBase)) {
      this.mode = 'local';
      this.localRegistryDir = this.resolveLocalRegistryDir(rawBase);
      this.baseUrl = new URL(DEFAULT_BASE_URL);
      this.baseOrigin = this.baseUrl.origin;
      this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
      this.githubToken = config.githubToken;
      return;
    }

    this.mode = 'remote';
    const normalizedBase = (rawBase ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.baseUrl = new URL(normalizedBase);
    this.baseOrigin = this.baseUrl.origin;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.githubToken = config.githubToken;
  }

  /**
   * 列出指定包在 GitHub Releases 中可用的 SemVer 版本
   *
   * @param packageName 包名称（用于匹配 release assets）
   * @returns 版本号数组或诊断错误
   */
  async listVersions(packageName: string): Promise<string[] | Diagnostic[]> {
    if (this.mode === 'local') {
      return this.listLocalVersions(packageName);
    }

    const releases = await this.fetchReleases();
    if (Array.isArray(releases) && releases.length > 0 && releases[0] && 'severity' in releases[0]) {
      return releases as Diagnostic[];
    }

    const versions = new Set<string>();
    for (const release of releases as GitHubRelease[]) {
      if (!this.releaseContainsPackage(release, packageName)) {
        continue;
      }
      const normalized = this.normalizeTagName(release.tag_name);
      if (normalized) {
        versions.add(normalized);
      }
    }
    return Array.from(versions);
  }

  /**
   * 下载指定包的 tarball 文件并写入目标路径
   *
   * @param packageName 包名称
   * @param version 目标版本
   * @param destPath 最终写入路径
   */
  async downloadPackage(packageName: string, version: string, destPath: string): Promise<void | Diagnostic[]> {
    if (this.mode === 'local') {
      return this.downloadLocalPackage(packageName, version, destPath);
    }

    const release = await this.fetchReleaseByVersion(version);
    if (Array.isArray(release) && release.length > 0 && release[0] && 'severity' in release[0]) {
      return release as Diagnostic[];
    }

    const asset = this.findAssetForPackage(release as GitHubRelease, packageName, version);
    if (!asset) {
      return buildHttpDiagnostics(
        DiagnosticCode.R003_PackageNotFoundOnGitHub,
        `未找到 ${packageName}@${version} 的 tarball 资源`
      );
    }

    const tempDir = await mkdtemp(join(tmpdir(), 'aster-pkg-'));
    const tempFile = join(tempDir, `${packageName.replace(/[\\/]/g, '-')}-${version}.tar.gz`);

    try {
      await this.downloadAsset(new URL(asset.browser_download_url), tempFile, asset.size);
      await rename(tempFile, destPath);
      return undefined;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return buildHttpDiagnostics(DiagnosticCode.R004_DownloadFailed, `下载失败：${message}`);
    } finally {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // 忽略清理错误
      }
    }
  }

  /**
   * 查询 GitHub API 的 rate limit 信息
   */
  async checkRateLimit(): Promise<RateLimitInfo | Diagnostic[]> {
    if (this.mode === 'local') {
      return buildHttpDiagnostics(DiagnosticCode.R007_InvalidResponse, '本地注册表不支持速率限制查询');
    }

    const response = await this.getJson<RateApiResponse>('/rate_limit');
    if (Array.isArray(response) && response.length > 0 && response[0] && 'severity' in response[0]) {
      return response as Diagnostic[];
    }

    const info = this.extractRateLimitInfo((response as JsonResponse<RateApiResponse>).headers, (response as JsonResponse<RateApiResponse>).data);
    if (!info) {
      return buildHttpDiagnostics(
        DiagnosticCode.R007_InvalidResponse,
        '无法从响应头解析 rate limit 信息'
      );
    }
    return info;
  }

  private shouldUseLocalRegistry(base: string): boolean {
    if (base === 'local') {
      return true;
    }
    if (base.startsWith('file://')) {
      return true;
    }
    return !/^https?:\/\//i.test(base);
  }

  private resolveLocalRegistryDir(base: string): string {
    if (base === 'local') {
      return this.locateWorkspaceLocalRegistry();
    }
    if (base.startsWith('file://')) {
      return fileURLToPath(base);
    }
    return resolve(process.cwd(), base);
  }

  private locateWorkspaceLocalRegistry(): string {
    let current = process.cwd();
    while (true) {
      const candidate = resolve(current, '.aster', 'local-registry');
      if (existsSync(candidate)) {
        return candidate;
      }
      const parent = dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
    return resolve(process.cwd(), '.aster', 'local-registry');
  }

  private async listLocalVersions(packageName: string): Promise<string[] | Diagnostic[]> {
    if (!this.localRegistryDir) {
      return buildHttpDiagnostics(DiagnosticCode.R007_InvalidResponse, '本地注册表目录未配置');
    }
    const packageDir = join(this.localRegistryDir, packageName);
    try {
      const stats = await stat(packageDir);
      if (!stats.isDirectory()) {
        return buildHttpDiagnostics(
          DiagnosticCode.V003_PackageNotFound,
          `本地注册表缺少 ${packageName}，请确认 ${packageDir} 是否存在`
        );
      }
    } catch {
      return buildHttpDiagnostics(
        DiagnosticCode.V003_PackageNotFound,
        `本地注册表缺少 ${packageName}，请确认 ${packageDir} 是否存在`
      );
    }

    try {
      const entries = await readdir(packageDir, { withFileTypes: true });
      const versions: string[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.tar.gz')) {
          continue;
        }
        const candidate = entry.name.replace(/\.tar\.gz$/u, '');
        const parsed = parseVersion(candidate);
        if (parsed) {
          versions.push(parsed.version);
        }
      }

      if (versions.length === 0) {
        return buildHttpDiagnostics(
          DiagnosticCode.V003_PackageNotFound,
          `本地注册表未找到 ${packageName} 的任何版本：${packageDir}`
        );
      }

      versions.sort((a, b) => a.localeCompare(b));
      return versions;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return buildHttpDiagnostics(DiagnosticCode.R004_DownloadFailed, `读取本地注册表失败：${message}`);
    }
  }

  private async downloadLocalPackage(
    packageName: string,
    version: string,
    destPath: string
  ): Promise<void | Diagnostic[]> {
    if (!this.localRegistryDir) {
      return buildHttpDiagnostics(DiagnosticCode.R007_InvalidResponse, '本地注册表目录未配置');
    }
    const source = join(this.localRegistryDir, packageName, `${version}.tar.gz`);
    try {
      const stats = await stat(source);
      if (!stats.isFile()) {
        return buildHttpDiagnostics(
          DiagnosticCode.V003_PackageNotFound,
          `本地注册表缺少 ${packageName}@${version}：${source}`
        );
      }
    } catch {
      return buildHttpDiagnostics(
        DiagnosticCode.V003_PackageNotFound,
        `本地注册表缺少 ${packageName}@${version}：${source}`
      );
    }

    try {
      await copyFile(source, destPath);
      return undefined;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return buildHttpDiagnostics(DiagnosticCode.R004_DownloadFailed, `复制本地包失败：${message}`);
    }
  }

  private async fetchReleases(): Promise<GitHubRelease[] | Diagnostic[]> {
    const response = await this.getJson<GitHubRelease[]>(RELEASES_PATH, { per_page: 100 });
    if (Array.isArray(response) && response.length > 0 && response[0] && 'severity' in response[0]) {
      return response as Diagnostic[];
    }
    return (response as JsonResponse<GitHubRelease[]>).data;
  }

  private async fetchReleaseByVersion(version: string): Promise<GitHubRelease | Diagnostic[]> {
    const candidates = this.buildReleaseTagCandidates(version);
    for (const tag of candidates) {
      const response = await this.getJson<GitHubRelease>(`${RELEASES_PATH}/tags/${encodeURIComponent(tag)}`);
      if (Array.isArray(response) && response.length > 0 && response[0] && 'severity' in response[0]) {
        const diags = response as Diagnostic[];
        // 如果是404，继续尝试下一个候选tag
        if (diags.length > 0 && diags[0] && diags[0].code === DiagnosticCode.R003_PackageNotFoundOnGitHub) {
          continue;
        }
        return diags;
      }
      return (response as JsonResponse<GitHubRelease>).data;
    }
    return buildHttpDiagnostics(
      DiagnosticCode.R003_PackageNotFoundOnGitHub,
      `未找到 tag=${version} 的 release`
    );
  }

  private buildReleaseTagCandidates(version: string): string[] {
    const trimmed = version.trim();
    const candidates = new Set<string>();
    candidates.add(trimmed);
    candidates.add(trimmed.startsWith('v') ? trimmed.slice(1) : `v${trimmed}`);
    return Array.from(candidates).filter((tag) => tag.length > 0);
  }

  private normalizeTagName(tagName: string): string | null {
    if (!tagName) {
      return null;
    }
    const normalized = tagName.startsWith('v') ? tagName.slice(1) : tagName;
    const parsed = parseVersion(normalized);
    return parsed ? parsed.version : null;
  }

  private releaseContainsPackage(release: GitHubRelease, packageName: string): boolean {
    if (!release.assets || release.assets.length === 0) {
      return false;
    }
    const prefix = `${packageName}-`;
    return release.assets.some((asset) => asset.name.startsWith(prefix) && asset.name.endsWith('.tar.gz'));
  }

  private findAssetForPackage(release: GitHubRelease, packageName: string, version: string): GitHubAsset | null {
    if (!release.assets) {
      return null;
    }
    const expectedName = `${packageName}-${version}.tar.gz`;
    return release.assets.find((asset) => asset.name === expectedName) ?? null;
  }

  private extractRateLimitInfo(headers: IncomingHttpHeaders, payload: RateApiResponse): RateLimitInfo | null {
    const limit = this.parseNumberHeader(headers['x-ratelimit-limit']) ?? payload.rate?.limit;
    const remaining = this.parseNumberHeader(headers['x-ratelimit-remaining']) ?? payload.rate?.remaining;
    const resetSeconds = this.parseNumberHeader(headers['x-ratelimit-reset']) ?? payload.rate?.reset;
    if (limit === undefined || remaining === undefined || resetSeconds === undefined) {
      return null;
    }
    return {
      limit,
      remaining,
      reset: new Date(resetSeconds * 1000),
    };
  }

  private parseNumberHeader(value: string | string[] | undefined): number | undefined {
    if (Array.isArray(value)) {
      return this.parseNumberHeader(value[0]);
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  private async getJson<T>(
    path: string,
    query?: Record<string, string | number>
  ): Promise<JsonResponse<T> | Diagnostic[]> {
    try {
      const url = this.buildApiUrl(path, query);
      const result = await this.performBufferRequest(url, true, {
        Accept: 'application/vnd.github+json',
      });
      if (result.statusCode < 200 || result.statusCode >= 300) {
        return this.buildHttpDiagnostics('GitHub API', result.statusCode, result.body, result.headers);
      }
      const data = JSON.parse(result.body.toString('utf-8')) as T;
      return { data, headers: result.headers };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return buildHttpDiagnostics(DiagnosticCode.R001_NetworkError, `网络请求失败：${message}`);
    }
  }

  private buildHttpDiagnostics(
    context: string,
    statusCode: number,
    body: Buffer,
    headers: IncomingHttpHeaders
  ): Diagnostic[] {
    const detail = this.extractMessageFromBody(body);
    if (statusCode === 403 && headers['x-ratelimit-remaining'] === '0') {
      const reset = this.parseNumberHeader(headers['x-ratelimit-reset']);
      const retryAfter = reset ? new Date(reset * 1000).toISOString() : '稍后';
      return buildHttpDiagnostics(
        DiagnosticCode.R002_RateLimitExceeded,
        `${context} 被 GitHub 速率限制，请在 ${retryAfter} 重试`
      );
    }
    if (statusCode === 404) {
      return buildHttpDiagnostics(
        DiagnosticCode.R003_PackageNotFoundOnGitHub,
        `${context} 返回 404：${detail ?? '资源不存在'}`
      );
    }
    const suffix = detail ? `：${detail}` : '';
    return buildHttpDiagnostics(
      DiagnosticCode.R007_InvalidResponse,
      `${context} 请求失败（HTTP ${statusCode}）${suffix}`
    );
  }

  private extractMessageFromBody(body: Buffer): string | null {
    if (body.length === 0) {
      return null;
    }
    try {
      const parsed = JSON.parse(body.toString('utf-8')) as { message?: string };
      if (parsed?.message) {
        return parsed.message;
      }
    } catch {
      // 忽略 JSON 解析错误，直接返回原始文本
    }
    return body.toString('utf-8').trim() || null;
  }

  private buildApiUrl(path: string, query?: Record<string, string | number>): URL {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(this.baseUrl.toString());
    const basePath = this.baseUrl.pathname.replace(/\/$/, '');
    url.pathname = `${basePath}${normalizedPath}`;
    url.search = '';
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, String(value));
      }
    }
    return url;
  }

  private async performBufferRequest(
    url: URL,
    includeAuth: boolean,
    headers: Record<string, string>,
    redirectCount = 0
  ): Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: Buffer }> {
    if (redirectCount > MAX_REDIRECTS) {
      throw new Error(`请求 ${url.toString()} 遇到过多重定向`);
    }

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          method: 'GET',
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port,
          path: `${url.pathname}${url.search}`,
          headers: this.buildHeaders(headers, includeAuth && this.isApiHost(url)),
          timeout: this.timeout,
        },
        (res) => {
          if (this.isRedirect(res.statusCode) && res.headers.location) {
            res.resume();
            const redirectUrl = new URL(res.headers.location, url);
            this.performBufferRequest(redirectUrl, includeAuth, headers, redirectCount + 1)
              .then(resolve)
              .catch(reject);
            return;
          }

          const chunks: Buffer[] = [];
          res.on('data', (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks),
            });
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error(`请求 ${url.toString()} 超时`));
      });
      req.end();
    });
  }

  private async downloadAsset(url: URL, destination: string, expectedSize?: number, redirectCount = 0): Promise<void> {
    if (redirectCount > MAX_REDIRECTS) {
      throw new Error(`下载 ${url.toString()} 重定向过多`);
    }

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          method: 'GET',
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port,
          path: `${url.pathname}${url.search}`,
          headers: this.buildHeaders({ Accept: 'application/octet-stream' }, false),
          timeout: this.timeout,
        },
        (res) => {
          if (this.isRedirect(res.statusCode) && res.headers.location) {
            res.resume();
            this.downloadAsset(new URL(res.headers.location, url), destination, expectedSize, redirectCount + 1)
              .then(() => resolve())
              .catch(reject);
            return;
          }

          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            res.resume();
            reject(new Error(`下载失败（HTTP ${res.statusCode ?? 0}）`));
            return;
          }

          const fileStream = createWriteStream(destination);
          let bytesWritten = 0;
          res.on('data', (chunk) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytesWritten += buffer.length;
          });
          res.pipe(fileStream);

          const cleanup = (err: Error): void => {
            fileStream.destroy();
            reject(err);
          };

          res.on('error', cleanup);
          fileStream.on('error', cleanup);
          fileStream.on('finish', () => {
            const headerLength = this.parseNumberHeader(res.headers['content-length']);
            const targetSize = headerLength ?? expectedSize;
            if (targetSize !== undefined && bytesWritten !== targetSize) {
              cleanup(new Error(`下载大小校验失败，期望 ${targetSize}B，实际 ${bytesWritten}B`));
              return;
            }
            resolve();
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error(`下载 ${url.toString()} 超时`));
      });
      req.end();
    });
  }

  private isRedirect(statusCode?: number): boolean {
    return typeof statusCode === 'number' && statusCode >= 300 && statusCode < 400;
  }

  private isApiHost(url: URL): boolean {
    return url.origin === this.baseOrigin;
  }

  private buildHeaders(headers: Record<string, string>, includeAuth: boolean): Record<string, string> {
    const result: Record<string, string> = {
      'User-Agent': USER_AGENT,
      ...headers,
    };
    if (includeAuth && this.githubToken) {
      result.Authorization = `token ${this.githubToken}`;
    }
    return result;
  }
}
