export type WeightedMinCutEdge = {
  from: number;
  to: number;
  capacity: number;
};

export type WeightedMinCutInput = {
  nodeCount: number;
  source: number;
  sink: number;
  edges: WeightedMinCutEdge[];
};

export type WeightedMinCutResult = {
  maxFlow: number;
  cutCapacity: number;
  cutEdgeIndexes: number[];
  sourceSide: Uint8Array;
};

type ResidualEdge = {
  to: number;
  reverse: number;
  capacity: number;
  originalIndex: number;
};

export function solveWeightedMinCut(input: WeightedMinCutInput): WeightedMinCutResult {
  validateInput(input);

  const graph = createResidualGraph(input);
  const level = new Int32Array(input.nodeCount);
  const nextEdge = new Int32Array(input.nodeCount);
  let maxFlow = 0;

  while (buildLevelGraph(graph, input.source, input.sink, level)) {
    nextEdge.fill(0);

    while (true) {
      const pushed = sendFlow(graph, input.source, input.sink, Number.MAX_SAFE_INTEGER, level, nextEdge);
      if (pushed === 0) {
        break;
      }
      maxFlow += pushed;
    }
  }

  const sourceSide = collectSourceSide(graph, input.source);
  const cutEdgeIndexes: number[] = [];
  let cutCapacity = 0;

  for (let index = 0; index < input.edges.length; index += 1) {
    const edge = input.edges[index]!;
    if (edge.capacity <= 0 || sourceSide[edge.from] === 0 || sourceSide[edge.to] !== 0) {
      continue;
    }

    cutEdgeIndexes.push(index);
    cutCapacity += edge.capacity;
  }

  return {
    maxFlow,
    cutCapacity,
    cutEdgeIndexes,
    sourceSide
  };
}

function createResidualGraph(input: WeightedMinCutInput): ResidualEdge[][] {
  const graph = Array.from({ length: input.nodeCount }, () => [] as ResidualEdge[]);

  for (let index = 0; index < input.edges.length; index += 1) {
    const edge = input.edges[index]!;
    const forward: ResidualEdge = {
      to: edge.to,
      reverse: graph[edge.to]!.length,
      capacity: edge.capacity,
      originalIndex: index
    };
    const reverse: ResidualEdge = {
      to: edge.from,
      reverse: graph[edge.from]!.length,
      capacity: 0,
      originalIndex: -1
    };

    graph[edge.from]!.push(forward);
    graph[edge.to]!.push(reverse);
  }

  return graph;
}

function buildLevelGraph(graph: ResidualEdge[][], source: number, sink: number, level: Int32Array): boolean {
  level.fill(-1);
  const queue = new Uint32Array(graph.length);
  let head = 0;
  let tail = 0;

  level[source] = 0;
  queue[tail] = source;
  tail += 1;

  while (head < tail) {
    const node = queue[head]!;
    head += 1;

    for (const edge of graph[node]!) {
      if (edge.capacity <= 0 || level[edge.to] >= 0) {
        continue;
      }

      level[edge.to] = level[node]! + 1;
      if (edge.to === sink) {
        continue;
      }
      queue[tail] = edge.to;
      tail += 1;
    }
  }

  return level[sink] >= 0;
}

function sendFlow(
  graph: ResidualEdge[][],
  node: number,
  sink: number,
  flow: number,
  level: Int32Array,
  nextEdge: Int32Array
): number {
  if (node === sink) {
    return flow;
  }

  const edges = graph[node]!;
  for (; nextEdge[node]! < edges.length; nextEdge[node] += 1) {
    const edgeIndex = nextEdge[node]!;
    const edge = edges[edgeIndex]!;
    if (edge.capacity <= 0 || level[edge.to] !== level[node]! + 1) {
      continue;
    }

    const pushed = sendFlow(graph, edge.to, sink, Math.min(flow, edge.capacity), level, nextEdge);
    if (pushed === 0) {
      continue;
    }

    edge.capacity -= pushed;
    graph[edge.to]![edge.reverse]!.capacity += pushed;
    return pushed;
  }

  return 0;
}

function collectSourceSide(graph: ResidualEdge[][], source: number): Uint8Array {
  const visited = new Uint8Array(graph.length);
  const stack = new Uint32Array(graph.length);
  let stackSize = 0;

  visited[source] = 1;
  stack[stackSize] = source;
  stackSize += 1;

  while (stackSize > 0) {
    stackSize -= 1;
    const node = stack[stackSize]!;

    for (const edge of graph[node]!) {
      if (edge.capacity <= 0 || visited[edge.to] !== 0) {
        continue;
      }
      visited[edge.to] = 1;
      stack[stackSize] = edge.to;
      stackSize += 1;
    }
  }

  return visited;
}

function validateInput(input: WeightedMinCutInput): void {
  if (!Number.isInteger(input.nodeCount) || input.nodeCount <= 0) {
    throw new Error(`nodeCount must be a positive integer, received ${input.nodeCount}.`);
  }
  validateNode(input.source, input.nodeCount, "source");
  validateNode(input.sink, input.nodeCount, "sink");
  if (input.source === input.sink) {
    throw new Error("source and sink must be different nodes.");
  }

  for (const edge of input.edges) {
    validateNode(edge.from, input.nodeCount, "edge.from");
    validateNode(edge.to, input.nodeCount, "edge.to");
    if (!Number.isFinite(edge.capacity) || edge.capacity < 0) {
      throw new Error(`Edge capacity must be a finite non-negative number, received ${edge.capacity}.`);
    }
  }
}

function validateNode(node: number, nodeCount: number, label: string): void {
  if (!Number.isInteger(node) || node < 0 || node >= nodeCount) {
    throw new Error(`${label} node ${node} is outside graph with ${nodeCount} nodes.`);
  }
}
