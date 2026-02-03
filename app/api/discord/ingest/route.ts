import { NextRequest, NextResponse } from "next/server";
import { Graph } from "@/lib/types";
import {
  DiscordSampleConfig,
  listDiscordExportFiles,
  parseDiscordExportFile,
  sampleDiscordMessages,
} from "@/lib/discord";
import {
  buildTicketPrompt,
  buildTicketsFromMessages,
  refineTicketsWithLLM,
  ticketWeight,
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

  let tickets = baseTickets;
  if (body.useLLM) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is required when useLLM is true." },
        { status: 400 },
      );
    }
    const model = body.model ?? "gpt-4o-mini";
    tickets = await refineTicketsWithLLM(tickets, ticketSources, {
      apiKey,
      model,
      maxTickets: body.llmTicketLimit,
      maxInputChars: body.llmMaxInputChars,
    });
  }

  const chunks = tickets.reduce<Graph["chunks"]>((acc, ticket) => {
    const evidenceStart = ticket.evidence[0]?.timestamp;
    const evidenceEnd = ticket.evidence[ticket.evidence.length - 1]?.timestamp;
    acc[ticket.id] = {
      id: ticket.id,
      title: ticket.title,
      summary: ticket.summary,
      sourceType: "discord:ticket",
      sourceRef: ticket.evidence[0]?.url,
      weight: ticketWeight(ticket),
      component: ticket.channel,
      tags: ticket.tags,
      createdAt: evidenceStart,
      updatedAt: evidenceEnd,
      ticket,
    };
    return acc;
  }, {});

  const graph: Graph = { chunks, edges };
  const prompt = buildTicketPrompt(tickets);

  return NextResponse.json({
    channels: selected.map((meta) => meta.label),
    messageCount: sampled.length,
    ticketCount: tickets.length,
    graph,
    tickets,
    prompt,
  });
}
