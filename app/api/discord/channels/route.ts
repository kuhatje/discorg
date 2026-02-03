import { NextResponse } from "next/server";
import { listDiscordExportFiles } from "@/lib/discord";

export async function GET() {
  const channels = await listDiscordExportFiles();
  return NextResponse.json({ channels });
}
