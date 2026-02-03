import { NextRequest, NextResponse } from "next/server";
import { maximumWeightClosure, solveClosureBySize } from "@/lib/closure";
import { Graph } from "@/lib/types";

const parseSize = (value: string | null, fallback = 4) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export async function GET(req: NextRequest) {
  const sizeParam = req.nextUrl.searchParams.get("size");
  const size = parseSize(sizeParam, 4);
  return NextResponse.json({
    error: "No graph provided. POST a graph to this endpoint to solve closures.",
    requestedSize: size,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { size = 4, graph } = body as { size?: number; graph?: Graph };
    if (!graph) {
      return NextResponse.json({ error: "Graph is required." }, { status: 400 });
    }
    const closure = solveClosureBySize(graph, size);
    return NextResponse.json({ closure, graphSize: Object.keys(graph.chunks).length });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Closure solve failed." }, { status: 500 });
  }
}
