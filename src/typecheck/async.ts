import { DefaultCoreVisitor, createVisitorContext } from '../core/visitor.js';
import type { Core, Origin, Span } from '../types.js';
import { ErrorCode } from '../diagnostics/error_codes.js';
import { DiagnosticBuilder } from './diagnostics.js';

// 类型检查异步模块：收集 Start/Wait 调度信息并执行异步纪律校验。

export interface AsyncAnalysis {
  starts: Map<string, Span[]>;
  waits: Map<string, Span[]>;
}

export interface ScheduleNode {
  kind: 'Start' | 'Wait';
  name: string;
  index: number;
  blockDepth: number;
  conditionalDepth: number;
  origin: Span | undefined;
}

export interface AsyncSchedule {
  nodes: ScheduleNode[];
  taskNames: Set<string>;
  conditionalPaths: Map<number, string>;
  conditionalBranches: Map<number, Set<string>>;
}

export class AsyncVisitor extends DefaultCoreVisitor {
  constructor(
    private readonly starts: Map<string, Span[]>,
    private readonly waits: Map<string, Span[]>,
    private readonly fallbackSpan: Span
  ) {
    super();
  }

  private ensureEntry(map: Map<string, Span[]>, name: string): Span[] {
    let bucket = map.get(name);
    if (!bucket) {
      bucket = [];
      map.set(name, bucket);
    }
    return bucket;
  }

  private toSpan(origin: Origin | undefined): Span | undefined {
    return origin ? { start: origin.start, end: origin.end } : undefined;
  }

  private record(map: Map<string, Span[]>, name: string, span: Span | undefined): void {
    const bucket = this.ensureEntry(map, name);
    bucket.push(span ?? this.fallbackSpan);
  }

  override visitStatement(statement: Core.Statement, context: import('../core/visitor.js').VisitorContext): void {
    if (statement.kind === 'Start') {
      this.record(this.starts, statement.name, this.toSpan(statement.origin));
    } else if (statement.kind === 'Wait') {
      for (const name of statement.names) {
        this.record(this.waits, name, this.toSpan(statement.origin));
      }
    }
    super.visitStatement(statement, context);
  }
}

export class ScheduleBuilder extends DefaultCoreVisitor {
  readonly nodes: ScheduleNode[] = [];
  readonly taskNames = new Set<string>();
  private index = 0;
  private blockDepth = 0;
  private readonly conditionalStack: Array<{ id: number; value: string }> = [];
  private readonly pathRegistry = new Map<string, number>();
  private readonly pathLookup = new Map<number, string>();
  private readonly branchRegistry = new Map<number, Set<string>>();
  private nextConditionalId = 1;
  private nextPathId = 1;
  private isRootBlock = true;

  private toSpan(origin: Origin | undefined): Span | undefined {
    return origin ? { start: origin.start, end: origin.end } : undefined;
  }

  private currentPathId(): number {
    if (this.conditionalStack.length === 0) return 0;
    const key = this.conditionalStack.map(entry => `${entry.id}:${entry.value}`).join('|');
    let id = this.pathRegistry.get(key);
    if (id === undefined) {
      id = this.nextPathId++;
      this.pathRegistry.set(key, id);
      this.pathLookup.set(id, key);
    }
    return id;
  }

  private registerBranch(condId: number, value: string): void {
    let branches = this.branchRegistry.get(condId);
    if (!branches) {
      branches = new Set();
      this.branchRegistry.set(condId, branches);
    }
    branches.add(value);
  }

  private withConditional(condId: number, value: string, fn: () => void): void {
    this.registerBranch(condId, value);
    this.conditionalStack.push({ id: condId, value });
    try {
      fn();
    } finally {
      this.conditionalStack.pop();
    }
  }

  override visitBlock(block: Core.Block, ctx: import('../core/visitor.js').VisitorContext): void {
    const isRoot = this.isRootBlock;
    if (isRoot) {
      this.isRootBlock = false;
    } else {
      this.blockDepth++;
    }

    for (const statement of block.statements) {
      this.visitStatement(statement, ctx);
    }

    if (!isRoot) {
      this.blockDepth--;
    }
  }

  override visitStatement(statement: Core.Statement, ctx: import('../core/visitor.js').VisitorContext): void {
    const currentIndex = this.index++;
    const pathId = this.currentPathId();

    if (statement.kind === 'Start') {
      this.nodes.push({
        kind: 'Start',
        name: statement.name,
        index: currentIndex,
        blockDepth: this.blockDepth,
        conditionalDepth: pathId,
        origin: this.toSpan(statement.origin),
      });
      this.taskNames.add(statement.name);
    } else if (statement.kind === 'Wait') {
      for (const name of statement.names) {
        this.nodes.push({
          kind: 'Wait',
          name,
          index: currentIndex,
          blockDepth: this.blockDepth,
          conditionalDepth: pathId,
          origin: this.toSpan(statement.origin),
        });
        this.taskNames.add(name);
      }
    }

    switch (statement.kind) {
      case 'Let':
      case 'Set':
      case 'Return':
        this.visitExpression(statement.expr, ctx);
        return;
      case 'If': {
        this.visitExpression(statement.cond, ctx);
        const condId = this.nextConditionalId++;
        this.registerBranch(condId, 'then');
        this.withConditional(condId, 'then', () => {
          this.visitBlock(statement.thenBlock, ctx);
        });
        this.withConditional(condId, 'else', () => {
          if (statement.elseBlock) {
            this.visitBlock(statement.elseBlock, ctx);
          }
        });
        return;
      }
      case 'Match': {
        this.visitExpression(statement.expr, ctx);
        const condId = this.nextConditionalId++;
        let branchIndex = 0;
        for (const kase of statement.cases) {
          if (kase.pattern) this.visitPattern?.(kase.pattern, ctx);
          const branchLabel = `case#${branchIndex++}`;
          this.withConditional(condId, branchLabel, () => {
            if (kase.body.kind === 'Return') {
              this.visitExpression(kase.body.expr, ctx);
            } else {
              this.visitBlock(kase.body, ctx);
            }
          });
        }
        return;
      }
      case 'Scope':
        this.visitBlock({ kind: 'Block', statements: statement.statements }, ctx);
        return;
      case 'Start':
        this.visitExpression(statement.expr, ctx);
        return;
      case 'Wait':
        return;
    }
  }

  getConditionalPaths(): Map<number, string> {
    const result = new Map<number, string>();
    result.set(0, 'root');
    for (const [id, key] of this.pathLookup) {
      result.set(id, key);
    }
    return result;
  }

  getConditionalBranches(): Map<number, Set<string>> {
    return this.branchRegistry;
  }
}

export function collectAsync(block: Core.Block): AsyncAnalysis {
  const starts = new Map<string, Span[]>();
  const waits = new Map<string, Span[]>();
  const fallbackSpan: Span = {
    start: { line: 0, col: 0 },
    end: { line: 0, col: 0 },
  };

  new AsyncVisitor(starts, waits, fallbackSpan).visitBlock(block, createVisitorContext());
  return { starts, waits };
}

export function scheduleAsync(block: Core.Block): AsyncSchedule {
  const builder = new ScheduleBuilder();
  builder.visitBlock(block, createVisitorContext());
  return {
    nodes: builder.nodes,
    taskNames: builder.taskNames,
    conditionalPaths: builder.getConditionalPaths(),
    conditionalBranches: builder.getConditionalBranches(),
  };
}

export function validateSchedule(
  schedule: AsyncSchedule,
  analysis: AsyncAnalysis,
  diagnostics: DiagnosticBuilder
): void {
  const startsByTask = new Map<string, ScheduleNode[]>();
  const waitsByTask = new Map<string, ScheduleNode[]>();

  for (const node of schedule.nodes) {
    if (node.kind === 'Start') {
      const bucket = startsByTask.get(node.name);
      if (bucket) {
        bucket.push(node);
      } else {
        startsByTask.set(node.name, [node]);
      }
    } else {
      const bucket = waitsByTask.get(node.name);
      if (bucket) {
        bucket.push(node);
      } else {
        waitsByTask.set(node.name, [node]);
      }
    }
  }

  const assignmentCache = new Map<number, Map<number, string>>();
  const parseAssignments = (node: ScheduleNode): Map<number, string> => {
    const cached = assignmentCache.get(node.conditionalDepth);
    if (cached) return cached;
    const signature = schedule.conditionalPaths.get(node.conditionalDepth);
    const assignments = new Map<number, string>();
    if (signature && signature !== 'root') {
      for (const part of signature.split('|')) {
        if (!part) continue;
        const [condIdStr, value] = part.split(':', 2);
        if (!condIdStr || value === undefined) continue;
        const idNum = Number(condIdStr);
        if (!Number.isNaN(idNum)) {
          assignments.set(idNum, value);
        }
      }
    }
    assignmentCache.set(node.conditionalDepth, assignments);
    return assignments;
  };

  const pathsCompatible = (a: ScheduleNode, b: ScheduleNode): boolean => {
    const aAssignments = parseAssignments(a);
    const bAssignments = parseAssignments(b);
    for (const [condId, value] of aAssignments) {
      const other = bAssignments.get(condId);
      if (other !== undefined && other !== value) {
        return false;
      }
    }
    for (const [condId, value] of bAssignments) {
      const other = aAssignments.get(condId);
      if (other !== undefined && other !== value) {
        return false;
      }
    }
    return true;
  };

  const isPlaceholderSpan = (span: Span | undefined): boolean =>
    !span ||
    (span.start.line === 0 && span.start.col === 0 && span.end.line === 0 && span.end.col === 0);

  const pickFirstRealSpan = (spans: Span[] | undefined): Span | undefined =>
    spans?.find(span => !isPlaceholderSpan(span));

  const resolveSpan = (node: ScheduleNode, fallbacks: Span[] | undefined): Span | undefined =>
    isPlaceholderSpan(node.origin) ? pickFirstRealSpan(fallbacks) : node.origin;

  const hasBranchCoverage = (candidates: ScheduleNode[]): boolean => {
    if (candidates.length === 0) return false;
    const coverage = new Map<number, Set<string>>();
    for (const candidate of candidates) {
      const assignments = parseAssignments(candidate);
      if (assignments.size === 0) return false;
      for (const [condId, value] of assignments) {
        let bucket = coverage.get(condId);
        if (!bucket) {
          bucket = new Set();
          coverage.set(condId, bucket);
        }
        bucket.add(value);
      }
    }

    for (const [condId, observed] of coverage) {
      const possible = schedule.conditionalBranches.get(condId);
      if (!possible || possible.size === 0) return false;
      for (const value of possible) {
        if (!observed.has(value)) return false;
      }
    }
    return coverage.size > 0;
  };

  for (const [taskName, waitNodes] of waitsByTask) {
    const startNodes = startsByTask.get(taskName) ?? [];
    for (const wait of waitNodes) {
      const candidates = startNodes.filter(
        candidate => candidate.index < wait.index && pathsCompatible(candidate, wait)
      );

      let validStart = candidates.find(candidate => candidate.blockDepth <= wait.blockDepth);

      if (!validStart) {
        const deeperCandidates = candidates.filter(candidate => candidate.blockDepth > wait.blockDepth);
        if (deeperCandidates.length > 0 && hasBranchCoverage(deeperCandidates)) {
          validStart = deeperCandidates[0];
        }
      }

      if (!validStart) {
        diagnostics.error(ErrorCode.ASYNC_WAIT_BEFORE_START, resolveSpan(wait, analysis.waits.get(taskName)), {
          task: taskName,
        });
      }
    }
  }

  for (const [taskName, startNodes] of startsByTask) {
    startNodes.sort((a, b) => a.index - b.index);
    const observed: ScheduleNode[] = [];
    const count = analysis.starts.get(taskName)?.length ?? startNodes.length;

    for (const start of startNodes) {
      const conflicting = observed.find(prev => pathsCompatible(prev, start));
      if (conflicting) {
        diagnostics.error(ErrorCode.ASYNC_DUPLICATE_START, resolveSpan(start, analysis.starts.get(taskName)), {
          task: taskName,
          count,
        });
      } else {
        observed.push(start);
      }
    }
  }
}

export function checkAsyncDiscipline(f: Core.Func, diagnostics: DiagnosticBuilder): void {
  const asyncInfo = collectAsync(f.body);
  const schedule = scheduleAsync(f.body);
  const isPlaceholderSpan = (span: Span): boolean =>
    span.start.line === 0 && span.start.col === 0 && span.end.line === 0 && span.end.col === 0;
  const pickSpan = (spans: Span[] | undefined): Span | undefined =>
    spans?.find(s => !isPlaceholderSpan(s));

  const notWaited = [...asyncInfo.starts.keys()].filter(n => !asyncInfo.waits.has(n));
  for (const name of notWaited) {
    const spans = asyncInfo.starts.get(name);
    const firstSpan = pickSpan(spans);
    diagnostics.error(ErrorCode.ASYNC_START_NOT_WAITED, firstSpan, { task: name });
  }

  const notStarted = [...asyncInfo.waits.keys()].filter(n => !asyncInfo.starts.has(n));
  for (const name of notStarted) {
    const spans = asyncInfo.waits.get(name);
    const firstSpan = pickSpan(spans);
    diagnostics.error(ErrorCode.ASYNC_WAIT_NOT_STARTED, firstSpan, { task: name });
  }

  for (const [name, spans] of asyncInfo.waits) {
    if (spans.length > 1) {
      for (let i = 1; i < spans.length; i++) {
        const span = spans[i]!;
        const targetSpan = isPlaceholderSpan(span) ? undefined : span;
        diagnostics.warning(ErrorCode.ASYNC_DUPLICATE_WAIT, targetSpan, {
          task: name,
          count: spans.length,
        });
      }
    }
  }

  validateSchedule(schedule, asyncInfo, diagnostics);
}
