/**
 * dependency-graph.ts 单元测试
 */

import test from 'node:test';
import assert from 'node:assert';
import { performance } from 'node:perf_hooks';
import { DependencyGraph } from '../../src/package/dependency-graph.js';

const chainNodeIds = {
  A: 'A@1.0.0',
  B: 'B@1.0.0',
  C: 'C@1.0.0',
};

test('DependencyGraph 功能验证', async (t) => {
  await t.test('链式依赖应按安装顺序返回 [C, B, A]', () => {
    const graph = new DependencyGraph();
    graph.addNode('A', '1.0.0');
    graph.addNode('B', '1.0.0');
    graph.addNode('C', '1.0.0');

    graph.addEdge(chainNodeIds.A, chainNodeIds.B);
    graph.addEdge(chainNodeIds.B, chainNodeIds.C);

    const order = graph.topologicalSort();
    if (order instanceof Error) {
      throw order;
    }

    assert.deepStrictEqual(order, [chainNodeIds.C, chainNodeIds.B, chainNodeIds.A]);
    const cycles = graph.detectCycles();
    assert.strictEqual(cycles, null);
  });

  await t.test('钻石依赖应最先安装叶子节点', () => {
    const graph = new DependencyGraph();
    const packages = ['A', 'B', 'C', 'D'];
    for (const name of packages) {
      graph.addNode(name, '1.0.0');
    }

    const nodeId = (name: string) => `${name}@1.0.0`;
    graph.addEdge(nodeId('A'), nodeId('B'));
    graph.addEdge(nodeId('A'), nodeId('C'));
    graph.addEdge(nodeId('B'), nodeId('D'));
    graph.addEdge(nodeId('C'), nodeId('D'));

    const order = graph.topologicalSort();
    if (order instanceof Error) {
      throw order;
    }

    assert.strictEqual(order[0], nodeId('D'));
    const cycles = graph.detectCycles();
    assert.strictEqual(cycles, null);
  });

  await t.test('循环依赖应在拓扑排序与DFS中被捕获', () => {
    const graph = new DependencyGraph();
    const nodes = ['A', 'B', 'C'];
    for (const name of nodes) {
      graph.addNode(name, '1.0.0');
    }

    const nodeId = (name: string) => `${name}@1.0.0`;
    graph.addEdge(nodeId('A'), nodeId('B'));
    graph.addEdge(nodeId('B'), nodeId('C'));
    graph.addEdge(nodeId('C'), nodeId('A'));

    const order = graph.topologicalSort();
    assert.ok(order instanceof Error, '存在循环依赖时应返回 Error');

    const cycles = graph.detectCycles();
    assert.ok(Array.isArray(cycles), '应返回循环路径列表');
    assert.deepStrictEqual(cycles, [[nodeId('A'), nodeId('B'), nodeId('C'), nodeId('A')]]);
  });

  await t.test('应能在1000个节点内完成100ms内拓扑排序', () => {
    const graph = new DependencyGraph();
    const total = 1000;

    for (let i = 0; i < total; i += 1) {
      graph.addNode(`pkg-${i}`, '1.0.0');
    }

    for (let i = 0; i < total - 1; i += 1) {
      graph.addEdge(`pkg-${i}@1.0.0`, `pkg-${i + 1}@1.0.0`);
    }

    const start = performance.now();
    const order = graph.topologicalSort();
    const duration = performance.now() - start;

    if (order instanceof Error) {
      throw order;
    }

    assert.strictEqual(order.length, total);
    assert.ok(duration < 100, `拓扑排序耗时 ${duration.toFixed(2)}ms，需小于100ms`);
  });

  await t.test('边界情况：空图与单节点', () => {
    const emptyGraph = new DependencyGraph();
    const emptyOrder = emptyGraph.topologicalSort();
    if (emptyOrder instanceof Error) {
      throw emptyOrder;
    }
    assert.deepStrictEqual(emptyOrder, []);
    assert.strictEqual(emptyGraph.detectCycles(), null);

    const singleGraph = new DependencyGraph();
    singleGraph.addNode('solo', '1.0.0');
    const singleOrder = singleGraph.topologicalSort();
    if (singleOrder instanceof Error) {
      throw singleOrder;
    }
    assert.deepStrictEqual(singleOrder, ['solo@1.0.0']);
  });

  await t.test('添加不存在节点的边应抛出错误', () => {
    const graph = new DependencyGraph();
    graph.addNode('root', '1.0.0');

    assert.throws(() => graph.addEdge('root@1.0.0', 'missing@1.0.0'));
    assert.throws(() => graph.addEdge('missing@1.0.0', 'root@1.0.0'));
  });
});
