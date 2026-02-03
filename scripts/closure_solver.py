#!/usr/bin/env python3
"""
Optimal closure solver using a max-flow reduction.
Consumes a graph JSON on stdin; emits a closure JSON on stdout.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import deque
from typing import Any, Dict, List, Tuple


class Dinic:
    """Dinic max-flow implementation."""

    def __init__(self, n: int):
        self.n = n
        self.adj: List[List[Tuple[int, float, int]]] = [[] for _ in range(n)]

    def add_edge(self, u: int, v: int, cap: float) -> None:
        self.adj[u].append([v, cap, len(self.adj[v])])
        self.adj[v].append([u, 0.0, len(self.adj[u]) - 1])

    def max_flow(self, s: int, t: int) -> float:
        flow = 0.0
        INF = 1e30

        def bfs() -> List[int]:
            level = [-1] * self.n
            q: deque[int] = deque()
            q.append(s)
            level[s] = 0
            while q:
                v = q.popleft()
                for to, cap, _ in self.adj[v]:
                    if cap > 1e-9 and level[to] < 0:
                        level[to] = level[v] + 1
                        q.append(to)
            return level

        def dfs(v: int, pushed: float, level: List[int], it: List[int]) -> float:
            if v == t or pushed == 0:
                return pushed
            for i in range(it[v], len(self.adj[v])):
                to, cap, rev = self.adj[v][i]
                if cap > 1e-9 and level[to] == level[v] + 1:
                    tr = dfs(to, min(pushed, cap), level, it)
                    if tr > 0:
                        self.adj[v][i][1] -= tr
                        self.adj[to][rev][1] += tr
                        return tr
                it[v] += 1
            return 0.0

        while True:
            level = bfs()
            if level[t] < 0:
                break
            it = [0] * self.n
            while True:
                pushed = dfs(s, INF, level, it)
                if pushed <= 0:
                    break
                flow += pushed
        return flow

    def reachable(self, s: int) -> List[bool]:
        seen = [False] * self.n
        stack = [s]
        seen[s] = True
        while stack:
            v = stack.pop()
            for to, cap, _ in self.adj[v]:
                if cap > 1e-9 and not seen[to]:
                    seen[to] = True
                    stack.append(to)
        return seen


def compute_inf(weights: List[float], penalty: float) -> float:
    return sum(abs(w - penalty) for w in weights) + 1.0


def build_closure(graph: Dict[str, Any], penalty: float = 0.0) -> Dict[str, Any]:
    chunks = list(graph.get("chunks", {}).values())
    edges = graph.get("edges", [])
    n = len(chunks)
    if n == 0:
        return {"closure": [], "totalWeight": 0.0, "size": 0, "penalty": penalty}

    source = 0
    sink = 1
    offset = 2
    weights = [float(c.get("weight", 0.0)) for c in chunks]
    INF = compute_inf(weights, penalty)
    net = Dinic(n + offset)

    for idx, chunk in enumerate(chunks):
        node = idx + offset
        w = float(chunk.get("weight", 0.0)) - penalty
        if w >= 0:
            net.add_edge(source, node, w)
        else:
            net.add_edge(node, sink, -w)

    id_to_idx = {c.get("id"): i for i, c in enumerate(chunks)}
    for edge in edges:
        from_idx = id_to_idx.get(edge.get("from"))
        to_idx = id_to_idx.get(edge.get("to"))
        if from_idx is None or to_idx is None:
            continue
        net.add_edge(from_idx + offset, to_idx + offset, INF)

    net.max_flow(source, sink)
    reach = net.reachable(source)
    closure_ids = [
        chunks[i]["id"] for i in range(n) if reach[i + offset] and "id" in chunks[i]
    ]
    total = sum(graph["chunks"][cid].get("weight", 0.0) for cid in closure_ids)
    return {"closure": closure_ids, "totalWeight": total, "size": len(closure_ids), "penalty": penalty}


def maximum_weight_closure(graph: Dict[str, Any]) -> Dict[str, Any]:
    return build_closure(graph, 0.0)


def enforce_size_limit(graph: Dict[str, Any], closure_ids: List[str], k: int) -> List[str]:
    if len(closure_ids) <= k:
        return closure_ids

    edges = graph.get("edges", [])
    dependents: Dict[str, set] = {}
    for edge in edges:
        frm = edge.get("from")
        to = edge.get("to")
        if frm is None or to is None:
            continue
        dependents.setdefault(to, set()).add(frm)

    weights = {cid: graph["chunks"].get(cid, {}).get("weight", 0.0) for cid in closure_ids}
    removable = sorted(closure_ids, key=lambda cid: weights.get(cid, 0.0))  # low weight first
    keep = set(closure_ids)

    for cid in removable:
        if len(keep) <= k:
            break
        # A node can be removed if no remaining node depends on it.
        is_dependency = any(dep in keep for dep in dependents.get(cid, set()))
        if not is_dependency:
            keep.remove(cid)

    # If still too many (all nodes were dependencies), fall back to top-k by weight.
    if len(keep) > k:
        keep = set(sorted(closure_ids, key=lambda cid: weights.get(cid, 0.0), reverse=True)[:k])

    return [cid for cid in closure_ids if cid in keep]


def solve_closure_by_size(graph: Dict[str, Any], k: int) -> Dict[str, Any]:
    chunks = list(graph.get("chunks", {}).values())
    if k <= 0 or not chunks:
        return {"closure": [], "totalWeight": 0.0, "size": 0, "penalty": 0.0}
    if k >= len(chunks):
        return maximum_weight_closure(graph)

    weights = [float(c.get("weight", 0.0)) for c in chunks]
    min_w = min(weights)
    max_w = max(weights)
    low = min_w - abs(min_w) - 5.0
    high = max_w + abs(max_w) + 5.0

    best = None
    for _ in range(36):
        penalty = (low + high) / 2.0
        candidate = build_closure(graph, penalty)
        diff = abs(candidate["size"] - k)
        if (
            best is None
            or diff < abs(best["size"] - k)
            or (diff == abs(best["size"] - k) and candidate["totalWeight"] > best["totalWeight"])
        ):
            best = candidate
        if candidate["size"] > k:
            low = penalty
        else:
            high = penalty
    final = best or maximum_weight_closure(graph)
    final_ids = enforce_size_limit(graph, final["closure"], k)
    total = sum(graph["chunks"][cid].get("weight", 0.0) for cid in final_ids)
    return {**final, "closure": final_ids, "totalWeight": total, "size": len(final_ids)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Solve maximum-weight closure for a graph.")
    parser.add_argument("--size", type=int, default=None, help="Target closure size.")
    args = parser.parse_args()

    try:
        graph = json.load(sys.stdin)
    except json.JSONDecodeError:
        print("{}", file=sys.stderr)
        return 1

    if args.size is None:
        result = maximum_weight_closure(graph)
    else:
        result = solve_closure_by_size(graph, args.size)

    json.dump(result, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
