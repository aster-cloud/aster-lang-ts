import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { typecheckBrowser } from '../../../src/typecheck/browser.js';
import type { Core } from '../../../src/types.js';
import { toV2 } from '../../helpers/core-ir-v2.js';

const intType: Core.Type = toV2({ kind: 'TypeName', name: 'Int' });
const inferredPlaceholderType: Core.Type = toV2({ kind: 'TypeName', name: 'inferred' });

describe('function return inference regressions', () => {
  it('uses Data fields before first-pass inferred function signatures', () => {
    const application: Core.Data = toV2({
      kind: 'Data',
      name: 'Application',
      fields: [toV2({ name: 'intField', type: intType })]
    });
    const output: Core.Data = toV2({
      kind: 'Data',
      name: 'Output',
      fields: [toV2({ name: 'limit', type: intType })]
    });
    const determine: Core.Func = toV2({
      kind: 'Func',
      name: 'determine',
      typeParams: [],
      params: [toV2({ name: 'app', type: toV2({ kind: 'TypeName', name: 'Application' }) })],
      ret: inferredPlaceholderType,
      effects: [],
      effectCaps: [],
      effectCapsExplicit: false,
      retTypeInferred: true,
      body: toV2({
        kind: 'Block',
        statements: [
          toV2({
            kind: 'Return',
            expr: toV2({ kind: 'Name', name: 'app.intField' })
          })
        ]
      })
    });
    const createOutput: Core.Func = toV2({
      kind: 'Func',
      name: 'createOutput',
      typeParams: [],
      params: [toV2({ name: 'app', type: toV2({ kind: 'TypeName', name: 'Application' }) })],
      ret: toV2({ kind: 'TypeName', name: 'Output' }),
      effects: [],
      effectCaps: [],
      effectCapsExplicit: false,
      body: toV2({
        kind: 'Block',
        statements: [
          toV2({
            kind: 'Return',
            expr: toV2({
              kind: 'Construct',
              typeName: 'Output',
              fields: [
                {
                  name: 'limit',
                  expr: toV2({
                    kind: 'Call',
                    target: toV2({ kind: 'Name', name: 'determine' }),
                    args: [toV2({ kind: 'Name', name: 'app' })]
                  })
                }
              ]
            })
          })
        ]
      })
    });
    const module: Core.Module = toV2({
      kind: 'Module',
      name: 'demo.functionReturnInference',
      decls: [application, output, determine, createOutput]
    });

    const errors = typecheckBrowser(module).filter(diagnostic => diagnostic.severity === 'error');

    assert.deepStrictEqual(errors, []);
  });
});
