 "use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Graph, Chunk } from "@/lib/types";

type Props = {
  graph: Graph;
  selectedIds?: Set<string>;
  onSelectChunk?: (chunk: Chunk) => void;
  showFallbackEdges?: boolean;
};

type NodePos = { id: string; x: number; y: number; chunk: Chunk };
type EdgePos = { from: NodePos; to: NodePos };

const buildLayout = (graph: Graph): { nodes: NodePos[]; edges: EdgePos[] } => {
  const chunks = Object.values(graph.chunks);
  const count = chunks.length || 1;
  const area = Math.max(1, count) * 40; // tighter packing
  const k = Math.sqrt(area / count);
  const hashToFloat = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) | 0;
    }
    return (h % 10000) / 10000; // 0..1
  };

  const nodes: NodePos[] = chunks
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((chunk) => {
      const hx = hashToFloat(chunk.id + "x");
      const hy = hashToFloat(chunk.id + "y");
      return {
        id: chunk.id,
        x: (hx - 0.5) * 120,
        y: (hy - 0.5) * 120,
        chunk,
      };
    });

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const edges: EdgePos[] = graph.edges
    .map((e) => {
      const from = nodeMap.get(e.from);
      const to = nodeMap.get(e.to);
      if (!from || !to) return null;
      return { from, to };
    })
    .filter(Boolean) as EdgePos[];

  // Fruchterman-Reingold style iterations (deterministic; no randomness in updates)
  const iterations = 250;
  const tempStart = 20;
  for (let iter = 0; iter < iterations; iter++) {
    const disp = nodes.map(() => ({ x: 0, y: 0 }));
    // Repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const force = (k * k) / dist;
        const nx = (dx / dist) * force;
        const ny = (dy / dist) * force;
        disp[i].x += nx;
        disp[i].y += ny;
        disp[j].x -= nx;
        disp[j].y -= ny;
      }
    }
    // Attraction
    edges.forEach((e) => {
      const dx = e.from.x - e.to.x;
      const dy = e.from.y - e.to.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const force = (dist * dist) / k;
      const nx = (dx / dist) * force;
      const ny = (dy / dist) * force;
      const i = nodes.indexOf(e.from);
      const j = nodes.indexOf(e.to);
      if (i >= 0) {
        disp[i].x -= nx;
        disp[i].y -= ny;
      }
      if (j >= 0) {
        disp[j].x += nx;
        disp[j].y += ny;
      }
    });
    // Apply
    const temp = tempStart * (1 - iter / iterations);
    nodes.forEach((n, idx) => {
      const d = Math.sqrt(disp[idx].x * disp[idx].x + disp[idx].y * disp[idx].y) || 1;
      const limited = Math.min(d, temp);
      n.x += (disp[idx].x / d) * limited;
      n.y += (disp[idx].y / d) * limited;
    });
  }

  return { nodes, edges };
};

export default function GraphViewer({
  graph,
  selectedIds,
  onSelectChunk,
  showFallbackEdges = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const layout = useMemo(() => buildLayout(graph), [graph]);
  const edgesToDraw = useMemo(() => {
    if (layout.edges.length > 0) return layout.edges;
    if (!showFallbackEdges) return [];
    const fallback: EdgePos[] = [];
    const nodes = [...layout.nodes].sort((a, b) => a.id.localeCompare(b.id));
    for (let i = 0; i < nodes.length; i++) {
      const from = nodes[i];
      const to = nodes[(i + 1) % nodes.length];
      if (from && to && from !== to) {
        fallback.push({ from, to });
      }
    }
    return fallback;
  }, [layout.edges, layout.nodes, showFallbackEdges]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || layout.nodes.length === 0) return;
    const bbox = layout.nodes.reduce(
      (acc, n) => ({
        minX: Math.min(acc.minX, n.x),
        maxX: Math.max(acc.maxX, n.x),
        minY: Math.min(acc.minY, n.y),
        maxY: Math.max(acc.maxY, n.y),
      }),
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
    );
    const width = bbox.maxX - bbox.minX;
    const height = bbox.maxY - bbox.minY;
    const padding = 80;
    const availableW = canvas.clientWidth - padding;
    const availableH = canvas.clientHeight - padding;
    const scale = Math.max(
      0.1,
      Math.min(1.5, Math.min(availableW / Math.max(width, 1), availableH / Math.max(height, 1))),
    );
    setTransform({ x: 0, y: 0, k: scale });
  }, [layout.nodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      if (!canvas) return;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.scale(dpr, dpr);
      draw();
    };

    const draw = () => {
      if (!ctx) return;
      const { width, height } = canvas;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.restore();

      ctx.save();
      ctx.translate(canvas.clientWidth / 2 + transform.x, canvas.clientHeight / 2 + transform.y);
      ctx.scale(transform.k, transform.k);

      // Edges
      ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
      ctx.lineWidth = 1;
      edgesToDraw.forEach((e) => {
        ctx.beginPath();
        ctx.moveTo(e.from.x, e.from.y);
        ctx.lineTo(e.to.x, e.to.y);
        ctx.stroke();

        // Draw arrowhead
        if (edgesToDraw.length > 0) {
          const dx = e.to.x - e.from.x;
          const dy = e.to.y - e.from.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const ux = dx / dist;
          const uy = dy / dist;
          const arrowLen = 16;
          const arrowWidth = 6;
          const px = e.to.x - ux * 22; // offset from node radius
          const py = e.to.y - uy * 22;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px - uy * arrowWidth - ux * arrowLen, py + ux * arrowWidth - uy * arrowLen);
          ctx.lineTo(px + uy * arrowWidth - ux * arrowLen, py - ux * arrowWidth - uy * arrowLen);
          ctx.closePath();
          ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
          ctx.fill();
        }
      });

      // Nodes
      const nodeRadius = 24;
      layout.nodes.forEach((n) => {
        const isSelected = selectedIds?.has(n.id);
        ctx.beginPath();
        ctx.fillStyle = isSelected ? "#0ea5e9" : "#1f2937";
        ctx.strokeStyle = isSelected ? "#22d3ee" : "#334155";
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.arc(n.x, n.y, nodeRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#e2e8f0";
        ctx.font = "14px sans-serif";
        const weight = graph.chunks[n.id]?.weight ?? 0;
        const text = weight.toFixed(1);
        const metrics = ctx.measureText(text);
        ctx.fillText(text, n.x - metrics.width / 2, n.y + 4);
      });

      ctx.restore();
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [layout, transform, graph, selectedIds]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.001;
      const k = Math.min(4, Math.max(0.2, transform.k * (1 + delta)));
      setTransform((prev) => ({ ...prev, k }));
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [transform.k]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let isPanning = false;
    let lastX = 0;
    let lastY = 0;

    const onDown = (e: MouseEvent) => {
      isPanning = true;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onMove = (e: MouseEvent) => {
      if (!isPanning) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      setTransform((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
    };
    const onUp = () => {
      isPanning = false;
    };

    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onSelectChunk) return;
    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left - canvas.clientWidth / 2 - transform.x) / transform.k;
      const y = (e.clientY - rect.top - canvas.clientHeight / 2 - transform.y) / transform.k;
      const hit = layout.nodes.find((n) => {
        const dx = n.x - x;
        const dy = n.y - y;
        return dx * dx + dy * dy <= 16 * 16;
      });
      if (hit) onSelectChunk(hit.chunk);
    };
    canvas.addEventListener("click", handleClick);
    return () => canvas.removeEventListener("click", handleClick);
  }, [layout.nodes, transform, onSelectChunk]);

  return (
    <div
      style={{
        position: "relative",
        border: "1px solid #1f2937",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <canvas ref={canvasRef} style={{ width: "100%", height: 520, background: "#0b1221" }} />
      <div
        style={{
          position: "absolute",
          top: 8,
          right: 12,
          fontSize: 12,
          color: "rgba(226, 232, 240, 0.75)",
          pointerEvents: "none",
          textAlign: "right",
          lineHeight: 1.4,
        }}
      >
        Scroll to zoom, drag to pan.
        <br />
        Click a node to open details; selected nodes/edges are highlighted.
      </div>
    </div>
  );
}
