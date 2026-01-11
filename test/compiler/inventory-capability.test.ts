import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkflowSource, emitWorkflowJavaFromSource } from './workflow-emitter-helpers.js';

describe('inventory capability workflow emitter', () => {
  test('should emit Inventory reserve + release workflow with compensation handler', async () => {
    const moduleName = 'test.compiler.workflow.inventory';
    const funcName = 'fulfill_inventory';
    const steps = `    step reserve_inventory:
      return ok of Inventory.reserve("order-id", List.empty()).

    compensate:
      Inventory.release("reservation-id").
      return ok of "inventory released".
`;
    const source = buildWorkflowSource(moduleName, funcName, ['Inventory'], steps);
    const javaSource = await emitWorkflowJavaFromSource(source, moduleName, funcName);

    assert.match(
      javaSource,
      /registerTaskWithDependencies\("reserve_inventory",[\s\S]+?java\.util\.Collections\.emptySet\(\)\);/
    );
    assert.match(
      javaSource,
      /Inventory\.reserve\("order-id",\s*List\.empty\(\)\)/
    );
    assert.match(
      javaSource,
      /__workflow0Compensate0[\s\S]+?Inventory\.release\("reservation-id"\)/
    );
  });
});
