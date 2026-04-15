export type CpuProfileNode = {
  label: string;
  total: number;
  self: number;
  calls: number;
  children: CpuProfileNode[];
};

export type CpuTelemetrySnapshot = {
  used: number | null;
  limit: number | null;
  tickLimit: number | null;
  bucket: number | null;
  profile: CpuProfileNode[];
};

type MutableCpuProfileNode = {
  label: string;
  total: number;
  self: number;
  calls: number;
  children: MutableCpuProfileNode[];
};

type CpuProfilerSpan = {
  label: string;
  node: MutableCpuProfileNode;
  start: number;
  childTime: number;
};

export type CpuProfiler = {
  enabled: boolean;
  root: MutableCpuProfileNode;
  stack: CpuProfilerSpan[];
};

export function createCpuProfiler(): CpuProfiler {
  return {
    enabled: readCpuUsed() !== null,
    root: createProfileNode("root"),
    stack: []
  };
}

export function measureCpu<T>(profiler: CpuProfiler | undefined, label: string, fn: () => T): T {
  const span = beginCpuSpan(profiler, label);

  try {
    return fn();
  } finally {
    endCpuSpan(profiler, span);
  }
}

export function beginCpuSpan(profiler: CpuProfiler | undefined, label: string): CpuProfilerSpan | null {
  if (!profiler?.enabled) {
    return null;
  }

  const start = readCpuUsed();
  if (start === null) {
    return null;
  }

  const parent = profiler.stack[profiler.stack.length - 1]?.node ?? profiler.root;
  const span: CpuProfilerSpan = {
    label,
    node: ensureProfileChild(parent, label),
    start,
    childTime: 0
  };
  profiler.stack.push(span);
  return span;
}

export function endCpuSpan(profiler: CpuProfiler | undefined, span: CpuProfilerSpan | null): void {
  if (!profiler?.enabled || span === null) {
    return;
  }

  const current = profiler.stack[profiler.stack.length - 1];
  if (current !== span) {
    return;
  }

  profiler.stack.pop();

  const end = readCpuUsed();
  if (end === null) {
    return;
  }

  const total = Math.max(end - span.start, 0);
  const self = Math.max(total - span.childTime, 0);
  span.node.total += total;
  span.node.self += self;
  span.node.calls += 1;

  const parent = profiler.stack[profiler.stack.length - 1];
  if (parent) {
    parent.childTime += total;
  }
}

export function createEmptyCpuTelemetrySnapshot(): CpuTelemetrySnapshot {
  const cpu = readCpuState();

  return {
    used: null,
    limit: cpu.limit,
    tickLimit: cpu.tickLimit,
    bucket: cpu.bucket,
    profile: []
  };
}

export function snapshotCpuProfiler(profiler: CpuProfiler | undefined): CpuTelemetrySnapshot {
  const cpu = readCpuState();
  const root = profiler?.enabled ? cloneProfileNode(profiler.root) : createProfileNode("root");

  if (profiler?.enabled && cpu.used !== null && profiler.stack.length > 0) {
    const activeNodes: MutableCpuProfileNode[] = [];

    for (const span of profiler.stack) {
      const parent = activeNodes[activeNodes.length - 1] ?? root;
      activeNodes.push(ensureProfileChild(parent, span.label));
    }

    let activeChildTotal = 0;
    for (let index = profiler.stack.length - 1; index >= 0; index -= 1) {
      const span = profiler.stack[index]!;
      const node = activeNodes[index]!;
      const total = Math.max(cpu.used - span.start, 0);
      const self = Math.max(total - span.childTime - activeChildTotal, 0);

      node.total += total;
      node.self += self;
      node.calls += 1;
      activeChildTotal = total;
    }
  }

  return {
    used: roundCpuMetric(cpu.used),
    limit: cpu.limit,
    tickLimit: cpu.tickLimit,
    bucket: cpu.bucket,
    profile: root.children.map(finalizeProfileNode)
  };
}

function createProfileNode(label: string): MutableCpuProfileNode {
  return {
    label,
    total: 0,
    self: 0,
    calls: 0,
    children: []
  };
}

function ensureProfileChild(parent: MutableCpuProfileNode, label: string): MutableCpuProfileNode {
  for (const child of parent.children) {
    if (child.label === label) {
      return child;
    }
  }

  const child = createProfileNode(label);
  parent.children.push(child);
  return child;
}

function cloneProfileNode(node: MutableCpuProfileNode): MutableCpuProfileNode {
  return {
    label: node.label,
    total: node.total,
    self: node.self,
    calls: node.calls,
    children: node.children.map(cloneProfileNode)
  };
}

function finalizeProfileNode(node: MutableCpuProfileNode): CpuProfileNode {
  return {
    label: node.label,
    total: roundCpuMetric(node.total) ?? 0,
    self: roundCpuMetric(node.self) ?? 0,
    calls: node.calls,
    children: node.children.map(finalizeProfileNode)
  };
}

function readCpuState(): {
  used: number | null;
  limit: number | null;
  tickLimit: number | null;
  bucket: number | null;
} {
  const cpu = readCpuApi();

  return {
    used: readCpuUsed(cpu),
    limit: normalizeCpuNumber(cpu?.limit),
    tickLimit: normalizeCpuNumber(cpu?.tickLimit),
    bucket: normalizeCpuNumber(cpu?.bucket)
  };
}

function readCpuUsed(cpu: CPU | null = readCpuApi()): number | null {
  if (!cpu || typeof cpu.getUsed !== "function") {
    return null;
  }

  try {
    return normalizeCpuNumber(cpu.getUsed());
  } catch {
    return null;
  }
}

function readCpuApi(): CPU | null {
  if (typeof Game === "undefined" || typeof Game.cpu !== "object" || Game.cpu === null) {
    return null;
  }

  return Game.cpu;
}

function normalizeCpuNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundCpuMetric(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  return Math.round(value * 1000) / 1000;
}
