/**
 * PackageRegistry GitHub API 交互层单元测试
 *
 * 覆盖成功解析版本、rate limit、网络异常、404、下载与速率查询场景。
 */

import test from 'node:test';
import assert from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import nock from 'nock';
import { PackageRegistry } from '../../src/package/package-registry.js';
import type { Diagnostic } from '../../src/diagnostics/diagnostics.js';

const API_BASE = 'https://api.github.com';

function isDiagnostic(value: unknown): value is Diagnostic[] {
  return Array.isArray(value) && value.length > 0 && value[0] && typeof value[0] === 'object' && 'severity' in value[0];
}

const createRegistry = () =>
  new PackageRegistry({
    baseUrl: API_BASE,
    timeout: 2_000,
  });

test('PackageRegistry GitHub API 交互层', async (t) => {
  await t.before(() => {
    nock.disableNetConnect();
  });

  await t.after(() => {
    nock.enableNetConnect();
    nock.cleanAll();
  });

  await t.afterEach(() => {
    nock.cleanAll();
  });

  await t.test('应解析 release 列表并过滤非法版本与包', async () => {
    nock(API_BASE)
      .get('/repos/aster-lang/packages/releases')
      .query({ per_page: '100' })
      .reply(200, [
        {
          tag_name: 'v1.2.0',
          assets: [
            {
              name: 'aster.http-1.2.0.tar.gz',
              browser_download_url: 'https://objects.githubusercontent.com/file1',
            },
          ],
        },
        {
          tag_name: 'beta',
          assets: [
            {
              name: 'aster.http-beta.tar.gz',
              browser_download_url: 'https://objects.githubusercontent.com/file2',
            },
          ],
        },
        {
          tag_name: '1.1.0',
          assets: [
            {
              name: 'aster.http-1.1.0.tar.gz',
              browser_download_url: 'https://objects.githubusercontent.com/file3',
            },
          ],
        },
        {
          tag_name: '1.0.0',
          assets: [
            {
              name: 'aster.other-1.0.0.tar.gz',
              browser_download_url: 'https://objects.githubusercontent.com/file4',
            },
          ],
        },
      ]);

    const registry = createRegistry();
    const result = await registry.listVersions('aster.http');

    assert.ok(!(result instanceof Error), `应返回版本数组而非 Error，实际：${result}`);
    assert.deepStrictEqual(result.sort(), ['1.1.0', '1.2.0']);
  });

  await t.test('listVersions 遇到 rate limit 应返回错误', async () => {
    const resetEpoch = Math.floor(Date.now() / 1000) + 60;
    nock(API_BASE)
      .get('/repos/aster-lang/packages/releases')
      .query({ per_page: '100' })
      .reply(
        403,
        { message: 'API rate limit exceeded' },
        {
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(resetEpoch),
        }
      );

    const registry = createRegistry();
    const result = await registry.listVersions('aster.http');

    assert.ok(isDiagnostic(result), '应返回 Diagnostic[]');
    if (isDiagnostic(result)) {
      assert.match(result[0]?.message ?? '', /速率限制/, '错误信息应包含速率限制提示');
    }
  });

  await t.test('listVersions 遇到网络错误应返回 Error', async () => {
    nock(API_BASE)
      .get('/repos/aster-lang/packages/releases')
      .query({ per_page: '100' })
      .replyWithError(new Error('socket hang up'));

    const registry = createRegistry();
    const result = await registry.listVersions('aster.http');

    assert.ok(isDiagnostic(result), '应返回 Diagnostic[]');
    if (isDiagnostic(result)) {
      assert.match(result[0]?.message ?? '', /socket hang up/, '错误信息应包含底层异常描述');
    }
  });

  await t.test('listVersions 404 应告知资源不存在', async () => {
    nock(API_BASE)
      .get('/repos/aster-lang/packages/releases')
      .query({ per_page: '100' })
      .reply(404, { message: 'Not Found' });

    const registry = createRegistry();
    const result = await registry.listVersions('aster.http');

    assert.ok(isDiagnostic(result), '应返回 Diagnostic[]');
    if (isDiagnostic(result)) {
      assert.match(result[0]?.message ?? '', /404/, '应提及 404 状态');
    }
  });

  await t.test('downloadPackage 应下载 tarball 并写入目标路径', async () => {
    nock(API_BASE)
      .get('/repos/aster-lang/packages/releases/tags/1.2.0')
      .reply(404, { message: 'Not Found' });

    nock(API_BASE)
      .get('/repos/aster-lang/packages/releases/tags/v1.2.0')
      .reply(200, {
        tag_name: 'v1.2.0',
        assets: [
          {
            name: 'aster.http-1.2.0.tar.gz',
            browser_download_url: 'https://objects.githubusercontent.com/downloads/file.tar.gz',
            size: 14,
          },
        ],
      });

    const tarball = Buffer.from('fake tarball');
    nock('https://objects.githubusercontent.com')
      .get('/downloads/file.tar.gz')
      .reply(200, tarball, {
        'Content-Length': String(tarball.length),
      });

    const tempDir = await mkdtemp(join(tmpdir(), 'pkg-registry-test-'));
    const destPath = join(tempDir, 'aster-http.tar.gz');

    try {
      const registry = createRegistry();
      const result = await registry.downloadPackage('aster.http', '1.2.0', destPath);

      assert.ok(!isDiagnostic(result), `下载应成功，实际得到：${isDiagnostic(result) ? result[0]?.message : 'OK'}`);
      const content = await readFile(destPath);
      assert.deepStrictEqual(content, tarball);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  await t.test('downloadPackage 找不到 asset 应返回错误', async () => {
    nock(API_BASE)
      .get('/repos/aster-lang/packages/releases/tags/1.0.0')
      .reply(200, {
        tag_name: '1.0.0',
        assets: [
          {
            name: 'aster.other-1.0.0.tar.gz',
            browser_download_url: 'https://objects.githubusercontent.com/other.tar.gz',
          },
        ],
      });

    const registry = createRegistry();
    const result = await registry.downloadPackage('aster.http', '1.0.0', '/tmp/unused');

    assert.ok(isDiagnostic(result), '应返回 Diagnostic[]');
    if (isDiagnostic(result)) {
      assert.match(result[0]?.message ?? '', /未找到/, '需要提示缺少匹配 asset');
    }
  });

  await t.test('checkRateLimit 应从响应头解析 limit 信息', async () => {
    const resetEpoch = Math.floor(Date.now() / 1000) + 120;
    nock(API_BASE)
      .get('/rate_limit')
      .reply(
        200,
        {
          rate: {
            limit: 60,
            remaining: 42,
            reset: resetEpoch,
          },
        },
        {
          'X-RateLimit-Limit': '60',
          'X-RateLimit-Remaining': '42',
          'X-RateLimit-Reset': String(resetEpoch),
        }
      );

    const registry = createRegistry();
    const result = await registry.checkRateLimit();

    assert.ok(!isDiagnostic(result), `应返回 RateLimitInfo，实际：${result}`);
    if (!isDiagnostic(result)) {
      assert.strictEqual(result.limit, 60);
      assert.strictEqual(result.remaining, 42);
      assert.ok(Math.abs(result.reset.getTime() - resetEpoch * 1000) < 1000);
    }
  });
});
