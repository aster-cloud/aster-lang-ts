/**
 * Aster包清单文件解析器
 *
 * 负责读取、解析和验证manifest.json文件
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv, { type ValidateFunction, type ErrorObject } from 'ajv';
import type { Manifest, CapabilityKind } from '../manifest.js';
import { DiagnosticBuilder, DiagnosticCode, type Diagnostic } from '../diagnostics/diagnostics.js';
import type { Position } from '../types.js';

// 加载manifest.schema.json
// 从项目根目录加载schema（因为schema文件不会被编译到dist目录）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// 从dist/src/package回到项目根目录：../../../
const schemaPath = join(__dirname, '..', '..', '..', 'manifest.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));

const ajv = new Ajv({ strict: true, allErrors: true });
const validateSchema: ValidateFunction = ajv.compile(schema);

/**
 * 解析manifest.json文件
 *
 * @param filePath manifest.json文件路径
 * @returns 解析后的Manifest对象，或诊断错误数组
 */
export function parseManifest(filePath: string): Manifest | Diagnostic[] {
  // 读取文件
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      return [
        DiagnosticBuilder.error(DiagnosticCode.M002_ManifestFileNotFound)
          .withMessage(`找不到清单文件：${filePath}`)
          .withPosition(dummyPosition())
          .build(),
      ];
    }
    return [
      DiagnosticBuilder.error(DiagnosticCode.M001_ManifestParseError)
        .withMessage(`读取清单文件失败：${error.message}`)
        .withPosition(dummyPosition())
        .build(),
    ];
  }

  // 解析JSON
  let manifest: unknown;
  try {
    manifest = JSON.parse(content);
  } catch (err: unknown) {
    const error = err as Error;
    return [
      DiagnosticBuilder.error(DiagnosticCode.M001_ManifestParseError)
        .withMessage(`JSON解析失败：${error.message}`)
        .withPosition(dummyPosition())
        .build(),
    ];
  }

  // JSON Schema验证
  const isValid = validateSchema(manifest);
  if (!isValid && validateSchema.errors) {
    const diagnostics: Diagnostic[] = [];
    for (const error of validateSchema.errors) {
      const fieldPath = error.instancePath || '/';
      const errorDiagnostic = mapAjvErrorToDiagnostic(error, fieldPath, manifest);
      diagnostics.push(errorDiagnostic);
    }
    return diagnostics;
  }

  // 语义验证
  const typedManifest = manifest as Manifest;
  const semanticErrors = validateManifest(typedManifest);
  if (semanticErrors.length > 0) {
    return semanticErrors;
  }

  return typedManifest;
}

/**
 * 验证Manifest对象的语义正确性
 *
 * @param manifest 待验证的Manifest对象
 * @returns 诊断错误数组（空数组表示验证通过）
 */
export function validateManifest(manifest: Manifest): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // 验证包名称格式（如果存在）
  if (manifest.name) {
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(manifest.name)) {
      diagnostics.push(
        DiagnosticBuilder.error(DiagnosticCode.M003_InvalidPackageName)
          .withMessage(`包名称格式无效：${manifest.name}（必须是小写字母、数字、下划线，用点号分隔）`)
          .withPosition(dummyPosition())
          .build()
      );
    }
  }

  // 验证版本格式（如果存在）
  if (manifest.version) {
    if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
      diagnostics.push(
        DiagnosticBuilder.error(DiagnosticCode.M004_InvalidVersion)
          .withMessage(`版本格式无效：${manifest.version}（必须遵循 SemVer 格式，如 1.0.0）`)
          .withPosition(dummyPosition())
          .build()
      );
    }
  }

  // 验证依赖版本约束
  if (manifest.dependencies) {
    for (const [pkg, version] of Object.entries(manifest.dependencies)) {
      if (!isValidVersionConstraint(version)) {
        diagnostics.push(
          DiagnosticBuilder.error(DiagnosticCode.M005_InvalidVersionConstraint)
            .withMessage(`依赖 ${pkg} 的版本约束无效：${version}（支持 ^1.0.0、~1.0.0 或 1.0.0 格式）`)
            .withPosition(dummyPosition())
            .build()
        );
      }
    }
  }

  // 验证开发依赖版本约束
  if (manifest.devDependencies) {
    for (const [pkg, version] of Object.entries(manifest.devDependencies)) {
      if (!isValidVersionConstraint(version)) {
        diagnostics.push(
          DiagnosticBuilder.error(DiagnosticCode.M005_InvalidVersionConstraint)
            .withMessage(`开发依赖 ${pkg} 的版本约束无效：${version}（支持 ^1.0.0、~1.0.0 或 1.0.0 格式）`)
            .withPosition(dummyPosition())
            .build()
        );
      }
    }
  }

  // 验证effects格式（如果存在）
  if (manifest.effects) {
    for (const effect of manifest.effects) {
      if (!/^[A-Z][a-zA-Z0-9]*$/.test(effect)) {
        diagnostics.push(
          DiagnosticBuilder.error(DiagnosticCode.M006_InvalidEffectName)
            .withMessage(`效果名称格式无效：${effect}（必须是 PascalCase 格式，如 HttpRequest）`)
            .withPosition(dummyPosition())
            .build()
        );
      }
    }
  }

  // 验证capabilities（如果存在）
  if (manifest.capabilities) {
    const validCapabilities: CapabilityKind[] = ['Http', 'Sql', 'Time', 'Files', 'Secrets', 'AiModel', 'Cpu'];

    if (manifest.capabilities.allow) {
      for (const cap of manifest.capabilities.allow) {
        if (!validCapabilities.includes(cap)) {
          diagnostics.push(
            DiagnosticBuilder.error(DiagnosticCode.M008_InvalidCapability)
              .withMessage(`无效的能力声明：${cap}（有效值为：${validCapabilities.join(', ')}）`)
              .withPosition(dummyPosition())
              .build()
          );
        }
      }
    }

    if (manifest.capabilities.deny) {
      for (const cap of manifest.capabilities.deny) {
        if (!validCapabilities.includes(cap)) {
          diagnostics.push(
            DiagnosticBuilder.error(DiagnosticCode.M008_InvalidCapability)
              .withMessage(`无效的能力声明：${cap}（有效值为：${validCapabilities.join(', ')}）`)
              .withPosition(dummyPosition())
              .build()
          );
        }
      }
    }
  }

  return diagnostics;
}

/**
 * 检查版本约束是否有效
 * 支持 ^1.0.0、~1.0.0 或 1.0.0 格式
 */
function isValidVersionConstraint(version: string): boolean {
  return /^(\^|~)?\d+\.\d+\.\d+$/.test(version);
}

/**
 * 将ajv验证错误映射为Diagnostic
 */
function mapAjvErrorToDiagnostic(error: ErrorObject, fieldPath: string, sourceData: unknown): Diagnostic {
  const pos = dummyPosition();
  const fieldValue = formatDiagnosticValue(sourceData, fieldPath);

  switch (error.keyword) {
    case 'pattern':
      if (fieldPath.includes('/name')) {
        return DiagnosticBuilder.error(DiagnosticCode.M003_InvalidPackageName)
          .withMessage(`包名称格式无效：${fieldValue}（必须是小写字母、数字、下划线，用点号分隔）`)
          .withPosition(pos)
          .build();
      }
      if (fieldPath.includes('/version')) {
        return DiagnosticBuilder.error(DiagnosticCode.M004_InvalidVersion)
          .withMessage(`版本格式无效：${fieldValue}（必须遵循 SemVer 格式，如 1.0.0）`)
          .withPosition(pos)
          .build();
      }
      if (fieldPath.includes('/dependencies') || fieldPath.includes('/devDependencies')) {
        return DiagnosticBuilder.error(DiagnosticCode.M005_InvalidVersionConstraint)
          .withMessage(`版本约束格式无效：${fieldValue}（支持 ^1.0.0、~1.0.0 或 1.0.0 格式）`)
          .withPosition(pos)
          .build();
      }
      if (fieldPath.includes('/effects')) {
        return DiagnosticBuilder.error(DiagnosticCode.M006_InvalidEffectName)
          .withMessage(`效果名称格式无效：${fieldValue}（必须是 PascalCase 格式）`)
          .withPosition(pos)
          .build();
      }
      break;

    case 'additionalProperties':
      return DiagnosticBuilder.error(DiagnosticCode.M007_UnknownManifestField)
        .withMessage(`未知的清单字段：${error.params.additionalProperty}`)
        .withPosition(pos)
        .build();

    case 'enum':
      if (fieldPath.includes('/capabilities')) {
        return DiagnosticBuilder.error(DiagnosticCode.M008_InvalidCapability)
          .withMessage(`无效的能力声明：${fieldValue}（有效值为：Http、Sql、Time、Files、Secrets、AiModel、Cpu）`)
          .withPosition(pos)
          .build();
      }
      break;
  }

  // 默认错误
  return DiagnosticBuilder.error(DiagnosticCode.M001_ManifestParseError)
    .withMessage(`清单验证失败：${error.message || '未知错误'}（字段：${fieldPath}）`)
    .withPosition(pos)
    .build();
}

/**
 * 创建占位位置信息
 * manifest.json文件层面的错误无法精确定位到具体行列
 */
function dummyPosition(): Position {
  return { line: 1, col: 1 };
}

function formatDiagnosticValue(sourceData: unknown, fieldPath: string): string {
  const raw = resolveJsonPointer(sourceData, fieldPath);
  if (raw === undefined) {
    return 'undefined';
  }
  if (raw === null) {
    return 'null';
  }
  if (typeof raw === 'string') {
    return raw;
  }
  if (typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw);
  }
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

function resolveJsonPointer(data: unknown, pointer: string): unknown {
  if (!pointer || pointer === '/') {
    return data;
  }

  const segments = pointer
    .split('/')
    .filter(Boolean)
    .map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'));

  let current: unknown = data;
  for (const segment of segments) {
    if (current && typeof current === 'object') {
      const container = current as Record<string, unknown>;
      current = container[segment];
    } else {
      return undefined;
    }
  }

  return current;
}
