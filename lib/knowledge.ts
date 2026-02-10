import { Edge, Graph, Ticket } from "./types";
import { buildTicketPrompt, ticketWeight } from "./tickets";

export type KnowledgeResponse = {
  graph: Graph;
  tickets: Ticket[];
  prompt: string;
  channels: string[];
  messageCount: number;
  ticketCount: number;
  updatedAt?: string;
};

export const buildGraphFromTickets = (tickets: Ticket[], edges: Edge[] = []): Graph => {
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

  return { chunks, edges };
};

export const buildKnowledgeResponse = (
  tickets: Ticket[],
  edges: Edge[] = [],
  updatedAt?: string,
): KnowledgeResponse => {
  const graph = buildGraphFromTickets(tickets, edges);
  const prompt = buildTicketPrompt(tickets);
  const channels = Array.from(new Set(tickets.map((t) => t.channel).filter(Boolean))) as string[];
  const messageIds = new Set<string>();
  tickets.forEach((ticket) => ticket.evidence.forEach((ev) => messageIds.add(ev.messageId)));
  return {
    graph,
    tickets,
    prompt,
    channels,
    messageCount: messageIds.size,
    ticketCount: tickets.length,
    ...(updatedAt ? { updatedAt } : {}),
  };
};

