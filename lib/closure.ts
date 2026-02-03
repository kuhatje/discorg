import { ChunkId, ClosureSolution, Graph } from "./types";

type DinicEdge = { to: number; rev: number; cap: number };

class Dinic {
  private adj: DinicEdge[][];

  constructor(private size: number) {
    this.adj = Array.from({ length: size }, () => []);
  }

  addEdge(u: number, v: number, cap: number) {
    const fwd: DinicEdge = { to: v, rev: this.adj[v].length, cap };
    const rev: DinicEdge = { to: u, rev: this.adj[u].length, cap: 0 };
    this.adj[u].push(fwd);
    this.adj[v].push(rev);
  }

  maxFlow(source: number, sink: number) {
    let flow = 0;
    const level: number[] = new Array(this.size);
    const it: number[] = new Array(this.size);

    const bfs = () => {
      level.fill(-1);
      const q: number[] = [];
      level[source] = 0;
      q.push(source);
      for (let i = 0; i < q.length; i++) {
        const v = q[i];
        for (const e of this.adj[v]) {
          if (e.cap > 1e-9 && level[e.to] < 0) {
            level[e.to] = level[v] + 1;
            q.push(e.to);
          }
        }
      }
      return level[sink] >= 0;
    };

    const dfs = (v: number, pushed: number): number => {
      if (v === sink || pushed === 0) return pushed;
      for (; it[v] < this.adj[v].length; it[v]++) {
        const e = this.adj[v][it[v]];
        if (e.cap > 1e-9 && level[e.to] === level[v] + 1) {
          const tr = dfs(e.to, Math.min(pushed, e.cap));
          if (tr > 0) {
            e.cap -= tr;
            this.adj[e.to][e.rev].cap += tr;
            return tr;
          }
        }
      }
      return 0;
    };

    while (bfs()) {
      it.fill(0);
      let pushed = dfs(source, Number.POSITIVE_INFINITY);
      while (pushed > 0) {
        flow += pushed;
        pushed = dfs(source, Number.POSITIVE_INFINITY);
      }
    }
    return flow;
  }

  reachable(source: number) {
    const seen = new Array(this.size).fill(false);
    const stack = [source];
    seen[source] = true;
    while (stack.length) {
      const v = stack.pop()!;
      for (const e of this.adj[v]) {
        if (e.cap > 1e-9 && !seen[e.to]) {
          seen[e.to] = true;
          stack.push(e.to);
        }
      }
    }
    return seen;
  }
}

const enforceSizeLimit = (graph: Graph, closureIds: ChunkId[], k: number): ChunkId[] => {
  if (closureIds.length <= k) return closureIds;

  const dependents = new Map<ChunkId, Set<ChunkId>>();
  graph.edges.forEach((e) => {
    const set = dependents.get(e.to) ?? new Set<ChunkId>();
    set.add(e.from);
    dependents.set(e.to, set);
  });

  const weights = closureIds.reduce<Record<string, number>>((acc, id) => {
    acc[id] = graph.chunks[id]?.weight ?? 0;
    return acc;
  }, {});

  const removable = [...closureIds].sort((a, b) => (weights[a] ?? 0) - (weights[b] ?? 0));
  const keep = new Set(closureIds);

  for (const cid of removable) {
    if (keep.size <= k) break;
    const deps = dependents.get(cid);
    const isDependency = deps ? [...deps].some((d) => keep.has(d)) : false;
    if (!isDependency) keep.delete(cid);
  }

  if (keep.size > k) {
    const top = [...keep].sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0)).slice(0, k);
    return top;
  }
  return [...keep];
};

const buildClosure = (graph: Graph, penalty = 0): ClosureSolution => {
  const chunks = Object.values(graph.chunks);
  const n = chunks.length;
  if (n === 0) return { closure: [], totalWeight: 0, size: 0, penalty };

  const source = 0;
  const sink = 1;
  const offset = 2;
  const weights = chunks.map((c) => c.weight ?? 0);
  const INF = weights.reduce((acc, w) => acc + Math.abs(w - penalty), 0) + 1;

  const dinic = new Dinic(n + offset);

  chunks.forEach((chunk, idx) => {
    const node = idx + offset;
    const w = (chunk.weight ?? 0) - penalty;
    if (w >= 0) dinic.addEdge(source, node, w);
    else dinic.addEdge(node, sink, -w);
  });

  graph.edges.forEach((edge) => {
    const fromIdx = chunks.findIndex((c) => c.id === edge.from);
    const toIdx = chunks.findIndex((c) => c.id === edge.to);
    if (fromIdx >= 0 && toIdx >= 0) {
      dinic.addEdge(fromIdx + offset, toIdx + offset, INF);
    }
  });

  dinic.maxFlow(source, sink);
  const reach = dinic.reachable(source);

  const closure: ChunkId[] = [];
  chunks.forEach((chunk, idx) => {
    if (reach[idx + offset]) closure.push(chunk.id);
  });

  const totalWeight = closure.reduce((acc, id) => acc + (graph.chunks[id]?.weight ?? 0), 0);
  return { closure, totalWeight, size: closure.length, penalty };
};

export const maximumWeightClosure = (graph: Graph): ClosureSolution => buildClosure(graph, 0);

export const solveClosureBySize = (graph: Graph, k: number): ClosureSolution => {
  const chunks = Object.values(graph.chunks);
  if (k <= 0 || chunks.length === 0) return { closure: [], totalWeight: 0, size: 0 };
  if (k >= chunks.length) return maximumWeightClosure(graph);

  const weights = chunks.map((c) => c.weight ?? 0);
  const minW = Math.min(...weights);
  const maxW = Math.max(...weights);
  let low = minW - Math.abs(minW) - 5;
  let high = maxW + Math.abs(maxW) + 5;

  let best: ClosureSolution | null = null;
  for (let i = 0; i < 36; i++) {
    const penalty = (low + high) / 2;
    const candidate = buildClosure(graph, penalty);
    const diff = Math.abs(candidate.size - k);
    if (
      !best ||
      diff < Math.abs(best.size - k) ||
      (diff === Math.abs(best.size - k) && candidate.totalWeight > best.totalWeight)
    ) {
      best = candidate;
    }
    if (candidate.size > k) low = penalty;
    else high = penalty;
  }

  const final = best ?? maximumWeightClosure(graph);
  const finalIds = enforceSizeLimit(graph, final.closure, k);
  const total = finalIds.reduce((acc, id) => acc + (graph.chunks[id]?.weight ?? 0), 0);
  return { ...final, closure: finalIds, totalWeight: total, size: finalIds.length };
};
