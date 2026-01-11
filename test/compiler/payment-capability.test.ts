import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkflowSource, emitWorkflowJavaFromSource } from './workflow-emitter-helpers.js';

describe('payment capability workflow emitter', () => {
  test('should emit Payment charge + refund workflow with compensation handler', async () => {
    const moduleName = 'test.compiler.workflow.payment';
    const funcName = 'fulfill_order';
    const steps = `    step charge_payment:
      return ok of Payment.charge("order-id", 100.0).

    compensate:
      Payment.refund("payment-id").
      return ok of "payment refunded".
`;
    const source = buildWorkflowSource(moduleName, funcName, ['Payment'], steps);
    const javaSource = await emitWorkflowJavaFromSource(source, moduleName, funcName);

    assert.match(
      javaSource,
      /registerTaskWithDependencies\("charge_payment",[\s\S]+?java\.util\.Collections\.emptySet\(\)\);/
    );
    assert.match(javaSource, /Payment\.charge\("order-id",\s*100(?:\.0)?\)/);
    assert.match(javaSource, /__workflow0Compensate0[\s\S]+?Payment\.refund\("payment-id"\)/);
  });
});
