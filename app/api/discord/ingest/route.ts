import { NextRequest, NextResponse } from "next/server";
import {
  DiscordSampleConfig,
  listDiscordExportFiles,
  parseDiscordExportFile,
  sampleDiscordMessages,
} from "@/lib/discord";
import { buildKnowledgeResponse } from "@/lib/knowledge";
import { loadOqoqoDocAnalyzerContext } from "@/lib/oqoqo";
import {
  createEmptyDiscordKnowledgeStore,
  loadDiscordKnowledgeStore,
  mergeDiscordKnowledge,
  saveDiscordKnowledgeStore,
} from "@/lib/persist";
import {
  buildTicketsFromMessages,
  refineTicketsWithLLM,
} from "@/lib/tickets";

type IngestPayload = DiscordSampleConfig & {
  channels?: string[];
  maxTickets?: number;
  maxMessagesPerTicket?: number;
  windowMinutes?: number;
  useLLM?: boolean;
  model?: string;
  llmTicketLimit?: number;
  llmMaxInputChars?: number;
  persist?: boolean;
  persistMode?: "append" | "replace";
  includeOqoqoContext?: boolean;
  oqoqoMaxIssues?: number;
  oqoqoMaxChars?: number;
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as IngestPayload;
  const channelFilter = body.channels ?? [];
  const allChannels = await listDiscordExportFiles();

  const selected =
    channelFilter.length > 0
      ? allChannels.filter((meta) =>
          channelFilter.some(
            (value) =>
              value === meta.file ||
              value === meta.channelId ||
              value === meta.channel ||
              value === meta.label,
          ),
        )
      : allChannels.slice(0, 4);

  if (selected.length === 0) {
    return NextResponse.json({ error: "No matching channels found." }, { status: 400 });
  }

  const messageGroups = await Promise.all(selected.map((meta) => parseDiscordExportFile(meta)));
  const allMessages = messageGroups.flat();
  const sampled = sampleDiscordMessages(allMessages, {
    maxMessagesPerChannel: body.maxMessagesPerChannel,
    maxMessagesTotal: body.maxMessagesTotal,
    maxCharsPerMessage: body.maxCharsPerMessage,
    sampleStrategy: body.sampleStrategy,
  });

  const { tickets: baseTickets, edges, ticketSources } = await buildTicketsFromMessages(sampled, {
    maxTickets: body.maxTickets,
    maxMessagesPerTicket: body.maxMessagesPerTicket,
    windowMinutes: body.windowMinutes,
  });

  let oqoqoContextSummary = "";
  let oqoqoContextError: string | undefined;
  let oqoqoContextIncluded = false;
  if (body.includeOqoqoContext) {
    const oqoqo = await loadOqoqoDocAnalyzerContext({
      maxIssues: body.oqoqoMaxIssues,
      maxChars: body.oqoqoMaxChars,
    });
    oqoqoContextSummary = oqoqo.summary;
    oqoqoContextIncluded = Boolean(oqoqo.summary);
    oqoqoContextError = oqoqo.error;
  }

  const persist = body.persist !== false;
  const persistMode = body.persistMode ?? "append";
  const stored = persist ? await loadDiscordKnowledgeStore() : null;

  // If a ticket already exists in the store, reuse it to avoid re-paying LLM costs.
  const knownTicketsById = stored?.ticketsById ?? {};
  let tickets = baseTickets.map((ticket) => knownTicketsById[ticket.id] ?? ticket);

  if (body.useLLM) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is required when useLLM is true." },
        { status: 400 },
      );
    }
    const model = body.model ?? "gpt-4o-mini";
    const knownIds = new Set(Object.keys(knownTicketsById));
    const toRefine = tickets.filter((t) => !knownIds.has(t.id));
    if (toRefine.length > 0) {
      const { tickets: refinedNew, stats } = await refineTicketsWithLLM(toRefine, ticketSources, {
        apiKey,
        model,
        maxTickets: body.llmTicketLimit,
        maxInputChars: body.llmMaxInputChars,
        extraContext: oqoqoContextSummary || undefined,
      });
      if (toRefine.length > 0 && stats.succeeded === 0) {
        return NextResponse.json(
          {
            error: "LLM refinement produced no successful tickets.",
            details: stats,
          },
          { status: 502 },
        );
      }
      const refinedMap = new Map(refinedNew.map((t) => [t.id, t] as const));
      tickets = tickets.map((t) => refinedMap.get(t.id) ?? t);
    }
  }

  let knowledgeTickets = tickets;
  let knowledgeEdges = edges;
  let updatedAt: string | undefined;
  let newTicketsAdded: number | undefined;

  if (persist) {
    const baseStore =
      persistMode === "replace"
        ? createEmptyDiscordKnowledgeStore()
        : stored ?? createEmptyDiscordKnowledgeStore();
    const prevCount = Object.keys(baseStore.ticketsById).length;
    const merged = mergeDiscordKnowledge(baseStore, { tickets, edges });
    await saveDiscordKnowledgeStore(merged);
    knowledgeTickets = Object.values(merged.ticketsById);
    knowledgeEdges = merged.edges;
    updatedAt = merged.updatedAt;
    newTicketsAdded = Object.keys(merged.ticketsById).length - prevCount;
  }

  const knowledge = buildKnowledgeResponse(knowledgeTickets, knowledgeEdges, updatedAt);
  const evidenceMessageCount = knowledge.messageCount;
  const prompt = oqoqoContextSummary
    ? `${knowledge.prompt}\n\nDoc-analyzer context (~/Desktop/oqoqo):\n${oqoqoContextSummary}`
    : knowledge.prompt;

  return NextResponse.json({
    channels: selected.map((meta) => meta.label),
    messageCount: evidenceMessageCount,
    sampledMessageCount: sampled.length,
    evidenceMessageCount,
    ticketCount: knowledge.ticketCount,
    graph: knowledge.graph,
    tickets: knowledge.tickets,
    prompt,
    oqoqoContextIncluded,
    oqoqoContextError,
    updatedAt,
    newTicketsAdded,
  });
}
