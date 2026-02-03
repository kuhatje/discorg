import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json({
    error: "No default graph. Use /api/ingest with a repo or POST /api/closure with a graph.",
  });
}
