#!/usr/bin/env node
/**
 * 验证 aster.jar 的 checksum 一致性
 *
 * 用途：
 * 1. 在 Gradle verify 阶段验证生成的 JAR 文件未被篡改
 * 2. 确保 TypeScript → Java 产物的跨工具链一致性
 *
 * 使用方式：
 * - npm run verify:jar:checksum
 * - node dist/scripts/verify-jar-checksum.js
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

function computeChecksum(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function main(): void {
  const outBase = process.env.ASTER_OUT_DIR?.trim() || 'build/aster-out';
  const jarPath = path.join(outBase, 'aster.jar');
  const checksumPath = path.join(outBase, 'aster.jar.sha256');

  // 检查文件存在性
  if (!fs.existsSync(jarPath)) {
    console.error(`JAR 文件不存在: ${jarPath}`);
    console.error('请先运行 npm run jar:jvm 生成 JAR');
    process.exit(1);
  }

  if (!fs.existsSync(checksumPath)) {
    console.error(`Checksum 文件不存在: ${checksumPath}`);
    console.error('请先运行 npm run jar:jvm 生成 checksum');
    process.exit(1);
  }

  // 读取保存的 checksum
  const savedContent = fs.readFileSync(checksumPath, 'utf-8').trim();
  const savedHash = savedContent.split(/\s+/)[0];

  if (!savedHash || savedHash.length !== 64) {
    console.error(`Checksum 文件格式无效: ${checksumPath}`);
    console.error(`内容: ${savedContent}`);
    process.exit(1);
  }

  // 计算当前 JAR 的 checksum
  const currentHash = computeChecksum(jarPath);

  // 比较
  if (currentHash === savedHash) {
    console.log('✓ Checksum 验证通过');
    console.log(`  文件: ${jarPath}`);
    console.log(`  SHA-256: ${currentHash}`);
    process.exit(0);
  } else {
    console.error('✗ Checksum 验证失败');
    console.error(`  文件: ${jarPath}`);
    console.error(`  期望: ${savedHash}`);
    console.error(`  实际: ${currentHash}`);
    console.error('');
    console.error('JAR 文件可能在生成后被修改，请重新运行 npm run jar:jvm');
    process.exit(1);
  }
}

main();
