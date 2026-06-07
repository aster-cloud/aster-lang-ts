import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { typecheckBrowser } from '../../../src/typecheck/browser.js';
import type { Core } from '../../../src/types.js';

const intType: Core.Type = { kind: 'TypeName', name: 'Int' };
const inferredPlaceholderType: Core.Type = { kind: 'TypeName', name: 'inferred' };

describe('function return inference regressions', () => {
  it('uses Data fields before first-pass inferred function signatures', () => {
    const application: Core.Data = {
      kind: 'Data',
      name: 'Application',
      fields: [{ name: 'intField', type: intType }]
    };
    const output: Core.Data = {
      kind: 'Data',
      name: 'Output',
      fields: [{ name: 'limit', type: intType }]
    };
    const determine: Core.Func = {
      kind: 'Func',
      name: 'determine',
      typeParams: [],
      params: [{ name: 'app', type: { kind: 'TypeName', name: 'Application' } }],
      ret: inferredPlaceholderType,
      effects: [],
      effectCaps: [],
      effectCapsExplicit: false,
      retTypeInferred: true,
      body: {
        kind: 'Block',
        statements: [
          {
            kind: 'Return',
            expr: { kind: 'Name', name: 'app.intField' }
          }
        ]
      }
    };
    const createOutput: Core.Func = {
      kind: 'Func',
      name: 'createOutput',
      typeParams: [],
      params: [{ name: 'app', type: { kind: 'TypeName', name: 'Application' } }],
      ret: { kind: 'TypeName', name: 'Output' },
      effects: [],
      effectCaps: [],
      effectCapsExplicit: false,
      body: {
        kind: 'Block',
        statements: [
          {
            kind: 'Return',
            expr: {
              kind: 'Construct',
              typeName: 'Output',
              fields: [
                {
                  name: 'limit',
                  expr: {
                    kind: 'Call',
                    target: { kind: 'Name', name: 'determine' },
                    args: [{ kind: 'Name', name: 'app' }]
                  }
                }
              ]
            }
          }
        ]
      }
    };
    const module: Core.Module = {
      kind: 'Module',
      name: 'demo.functionReturnInference',
      decls: [application, output, determine, createOutput]
    };

    const errors = typecheckBrowser(module).filter(diagnostic => diagnostic.severity === 'error');

    assert.deepStrictEqual(errors, []);
  });
});
