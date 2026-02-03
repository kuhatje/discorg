import { Graph } from "./types";

export const getComponentActivity = (graph: Graph, component: string) => {
  const chunks = Object.values(graph.chunks).filter((c) => c.component === component);
  const totalWeight = chunks.reduce((acc, c) => acc + c.weight, 0);
  const avgWeight = chunks.length ? totalWeight / chunks.length : 0;
  const top = chunks.sort((a, b) => b.weight - a.weight).slice(0, 3);
  return { component, count: chunks.length, totalWeight, avgWeight, top };
};

export const getTopDissatisfaction = (graph: Graph) => {
  const complaintTags = new Set(["incident", "support", "bug"]);
  return Object.values(graph.chunks)
    .filter((c) => (c.tags ?? []).some((t) => complaintTags.has(t)))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);
};
