import { join } from 'node:path';
import { defineConformanceSuite } from './conformance-runner.js';

// dist/scripts/aster.js 跑包格式 v1 全部一致性用例（ADR 0059 P1 T4）。
defineConformanceSuite('aster（dist/scripts/aster.js）', [join(process.cwd(), 'dist/scripts/aster.js')]);
