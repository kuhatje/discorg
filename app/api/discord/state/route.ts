import { NextResponse } from "next/server";
import { buildKnowledgeResponse } from "@/lib/knowledge";
import { clearDiscordKnowledgeStore, loadDiscordKnowledgeStore } from "@/lib/persist";

export async function GET() {
  const store = await loadDiscordKnowledgeStore();
  const tickets = Object.values(store.ticketsById).sort((a, b) => {
    const at = a.evidence[0]?.timestamp ?? "";
    const bt = b.evidence[0]?.timestamp ?? "";
    return at.localeCompare(bt);
  });
  return NextResponse.json(buildKnowledgeResponse(tickets, store.edges, store.updatedAt));
}

export async function DELETE() {
  await clearDiscordKnowledgeStore();
  return NextResponse.json({ ok: true });
}

