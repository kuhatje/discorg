import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { DISCORD_EXPORT_DIR, listDiscordExportFiles } from "@/lib/discord";

export async function GET(req: NextRequest) {
  const fileParam = req.nextUrl.searchParams.get("file");
  if (!fileParam) {
    return NextResponse.json({ error: "file is required." }, { status: 400 });
  }

  const file = path.basename(fileParam);
  const channels = await listDiscordExportFiles();
  const match = channels.find((channel) => channel.file === file);
  if (!match) {
    return NextResponse.json({ error: "file not found." }, { status: 404 });
  }

  const html = await fs.readFile(path.join(DISCORD_EXPORT_DIR, match.file), "utf8");
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
