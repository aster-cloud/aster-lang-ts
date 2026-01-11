/**
 * 依赖图数据结构，用于在包管理场景中维护包与依赖关系。
 */

/**
 * 节点元数据
 */
export interface DependencyNode {
  name: string;
  version: string;
}

/**
 * DFS访问状态
 */
const enum VisitState {
  UNVISITED = 0,
  VISITING = 1,
  VISITED = 2,
}

export class DependencyGraph {
  private readonly nodes = new Map<string, DependencyNode>();
  private readonly adjacency = new Map<string, Set<string>>();

  /**
   * 添加节点到依赖图
   *
   * @param name 包名称
   * @param version 包版本
   */
  addNode(name: string, version: string): void {
    const nodeId = this.createNodeId(name, version);
    if (this.nodes.has(nodeId)) {
      return;
    }

    this.nodes.set(nodeId, { name, version });
    this.adjacency.set(nodeId, new Set());
  }

  /**
   * 添加依赖边，from 依赖 to
   *
   * @param from 依赖方节点ID（name@version）
   * @param to 被依赖节点ID（name@version）
   */
  addEdge(from: string, to: string): void {
    const fromExists = this.nodes.has(from);
    const toExists = this.nodes.has(to);
    if (!fromExists || !toExists) {
      throw new Error(`无法添加依赖边：${from} 或 ${to} 节点不存在`);
    }

    const neighbors = this.adjacency.get(from);
    if (neighbors) {
      neighbors.add(to);
    } else {
      this.adjacency.set(from, new Set([to]));
    }
  }

  /**
   * 执行Kahn拓扑排序，返回安装顺序（依赖优先）
   */
  topologicalSort(): string[] | Error {
    const indegree = new Map<string, number>();
    for (const nodeId of this.nodes.keys()) {
      indegree.set(nodeId, 0);
    }

    for (const targets of this.adjacency.values()) {
      for (const target of targets) {
        indegree.set(target, (indegree.get(target) ?? 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [nodeId, degree] of indegree.entries()) {
      if (degree === 0) {
        queue.push(nodeId);
      }
    }

    const ordered: string[] = [];
    let head = 0;
    while (head < queue.length) {
      const nodeId = queue[head++]!;
      ordered.push(nodeId);
      const neighbors = this.adjacency.get(nodeId);
      if (!neighbors) {
        continue;
      }
      for (const neighbor of neighbors) {
        const nextDegree = (indegree.get(neighbor) ?? 0) - 1;
        indegree.set(neighbor, nextDegree);
        if (nextDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    if (ordered.length !== this.nodes.size) {
      return new Error('检测到循环依赖，无法完成拓扑排序');
    }

    return ordered.reverse();
  }

  /**
   * DFS检测循环依赖
   */
  detectCycles(): string[][] | null {
    const states = new Map<string, VisitState>();
    for (const nodeId of this.nodes.keys()) {
      states.set(nodeId, VisitState.UNVISITED);
    }

    const cycles: string[][] = [];
    const stack: string[] = [];

    const dfs = (nodeId: string): void => {
      states.set(nodeId, VisitState.VISITING);
      stack.push(nodeId);

      const neighbors = this.adjacency.get(nodeId);
      if (neighbors) {
        for (const neighbor of neighbors) {
          const state = states.get(neighbor) ?? VisitState.UNVISITED;
          if (state === VisitState.UNVISITED) {
            dfs(neighbor);
          } else if (state === VisitState.VISITING) {
            const cycleStartIndex = stack.indexOf(neighbor);
            if (cycleStartIndex !== -1) {
              const cyclePath = stack.slice(cycleStartIndex);
              cyclePath.push(neighbor);
              cycles.push(cyclePath);
            }
          }
        }
      }

      stack.pop();
      states.set(nodeId, VisitState.VISITED);
    };

    for (const nodeId of this.nodes.keys()) {
      if ((states.get(nodeId) ?? VisitState.UNVISITED) === VisitState.UNVISITED) {
        dfs(nodeId);
      }
    }

    return cycles.length > 0 ? cycles : null;
  }

  /**
   * 返回指定包的直接依赖节点列表。
   */
  getDirectDependencies(name: string, version: string): DependencyNode[] {
    const nodeId = this.createNodeId(name, version);
    const neighbors = this.adjacency.get(nodeId);
    if (!neighbors) {
      return [];
    }

    const dependencies: DependencyNode[] = [];
    for (const neighborId of neighbors) {
      const node = this.nodes.get(neighborId);
      if (node) {
        dependencies.push({ ...node });
      }
    }
    return dependencies;
  }

  private createNodeId(name: string, version: string): string {
    return `${name}@${version}`;
  }
}
