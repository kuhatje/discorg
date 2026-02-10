import { DiscordMessage, Ticket, TicketDocCoverage, TicketEvidence, TicketSeverity, Edge } from "./types";
import { createStructuredTicketWithOpenAI, OpenAIConfig } from "./openai";

export type TicketBuildConfig = {
  maxTickets?: number;
  maxMessagesPerTicket?: number;
  windowMinutes?: number;
};

const severityWeight: Record<TicketSeverity, number> = {
  low: 2,
  medium: 4,
  high: 7,
  critical: 10,
};

const keywordBuckets = {
  critical: ["data loss", "security", "vulnerability", "corrupt", "irreversible"],
  high: ["crash", "panic", "segfault", "broken", "fail", "exception", "bug"],
  medium: ["slow", "performance", "latency", "timeout", "scaling", "benchmark"],
  doc: ["docs", "documentation", "readme", "guide", "tutorial", "example", "how do i"],
  feature: ["feature request", "request", "would love", "can we", "could we", "nice to have"],
};

const normalize = (text: string) => text.toLowerCase();

const extractKeywords = (text: string) => {
  const found = new Set<string>();
  const lower = normalize(text);
  Object.values(keywordBuckets).flat().forEach((kw) => {
    if (lower.includes(kw)) found.add(kw);
  });
  return [...found];
};

const inferSeverity = (text: string, channel: string): TicketSeverity => {
  const lower = normalize(text);
  if (keywordBuckets.critical.some((kw) => lower.includes(kw))) return "critical";
  if (keywordBuckets.high.some((kw) => lower.includes(kw))) return "high";
  if (keywordBuckets.medium.some((kw) => lower.includes(kw))) return "medium";
  if (normalize(channel).includes("bug")) return "high";
  if (normalize(channel).includes("feature")) return "medium";
  return "low";
};

const inferDocCoverage = (text: string): TicketDocCoverage => {
  const lower = normalize(text);
  const mentionsDocs = keywordBuckets.doc.some((kw) => lower.includes(kw));
  if (!mentionsDocs) return "unknown";
  if (lower.includes("missing") || lower.includes("no doc") || lower.includes("not documented")) return "missing";
  if (lower.includes("unclear") || lower.includes("confusing") || lower.includes("outdated")) return "partial";
  return "adequate";
};

const buildTitle = (text: string, fallback: string) => {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return fallback;
  const sentence = trimmed.split(/[.!?]\s/)[0] ?? trimmed;
  const title = sentence.length > 90 ? `${sentence.slice(0, 90)}...` : sentence;
  return title || fallback;
};

const buildSummary = (text: string) => {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return "No summary available.";
  const sentences = trimmed.split(/[.!?]\s/).filter(Boolean);
  const summary = sentences.slice(0, 2).join(". ");
  return summary.length > 240 ? `${summary.slice(0, 240)}...` : summary;
};

const getTime = (msg: DiscordMessage) => {
  if (!msg.timestamp) return 0;
  const t = new Date(msg.timestamp).getTime();
  return Number.isNaN(t) ? 0 : t;
};

const isTicketCandidate = (msg: DiscordMessage) => {
  const lower = normalize(msg.content);
  if (lower.includes("?")) return true;
  if (keywordBuckets.high.some((kw) => lower.includes(kw))) return true;
  if (keywordBuckets.doc.some((kw) => lower.includes(kw))) return true;
  if (keywordBuckets.feature.some((kw) => lower.includes(kw))) return true;
  if (msg.links.some((link) => link.includes("github.com") && link.includes("/issues/"))) return true;
  const channelLower = normalize(msg.channel);
  if (channelLower.includes("bug") || channelLower.includes("feature") || channelLower.includes("help")) return true;
  return false;
};

const buildEvidence = (messages: DiscordMessage[]): TicketEvidence[] =>
  messages.map((msg) => ({
    messageId: msg.id,
    channel: msg.channel,
    snippet: msg.content.length > 200 ? `${msg.content.slice(0, 200)}...` : msg.content,
    url: msg.url,
    author: msg.author,
    timestamp: msg.timestamp,
  }));

const extractAffectedItems = (messages: DiscordMessage[]) => {
  const items = new Set<string>();
  messages.forEach((msg) => {
    msg.links.forEach((link) => {
      if (link.includes("github.com")) items.add(link);
      if (link.includes("docs") || link.includes("documentation")) items.add(link);
    });
  });
  return items.size ? [...items] : undefined;
};

const buildReasoning = (messages: DiscordMessage[], severity: TicketSeverity, docCoverage: TicketDocCoverage) => {
  const keywords = extractKeywords(messages.map((m) => m.content).join(" "));
  const timeStart = messages[0]?.timestamp ?? "unknown";
  const timeEnd = messages[messages.length - 1]?.timestamp ?? timeStart;
  return [
    `Collected ${messages.length} message(s) from ${messages[0]?.channel ?? "unknown channel"}.`,
    `Window: ${timeStart} -> ${timeEnd}.`,
    keywords.length ? `Keywords: ${keywords.join(", ")}.` : "Keywords: none.",
    `Severity inferred as ${severity}.`,
    `Documentation coverage inferred as ${docCoverage}.`,
  ].join(" ");
};

export type TicketGraphResult = {
  tickets: Ticket[];
  edges: Edge[];
  ticketSources: Record<string, DiscordMessage[]>;
};

export const buildTicketPrompt = (tickets: Ticket[]) => {
  const lines: string[] = [];
  lines.push(
    "You are a documentation triage assistant. Use the tickets below as grounded evidence from a Discord server.",
  );
  lines.push(
    "When the user asks about specific problems, respond with one entry per relevant ticket using this format:",
  );
  lines.push("- Summary of the issue");
  lines.push("- Links to evidence / affected items");
  lines.push("- Severity");
  lines.push("- Related documentation coverage");
  lines.push("");
  lines.push("Tickets (include background reasoning for internal use; do not reveal unless asked):");
  tickets.forEach((ticket, idx) => {
    lines.push(`\nTicket ${idx + 1}: ${ticket.title}`);
    lines.push(`Summary: ${ticket.summary}`);
    lines.push(`Severity: ${ticket.severity}`);
    lines.push(`Documentation coverage: ${ticket.docCoverage}`);
    if (ticket.affectedItems?.length) {
      lines.push(`Affected items: ${ticket.affectedItems.join(", ")}`);
    }
    if (ticket.evidence.length) {
      lines.push(
        `Evidence: ${ticket.evidence
          .map((ev) => `${ev.url ?? ev.messageId} (${ev.channel})`)
          .join(", ")}`,
      );
    }
    if (ticket.reasoning) {
      lines.push(`Background reasoning: ${ticket.reasoning}`);
    }
  });
  return lines.join("\n");
};

export const buildTicketsFromMessages = async (
  messages: DiscordMessage[],
  config: TicketBuildConfig = {},
): Promise<TicketGraphResult> => {
  const { maxTickets = 80, maxMessagesPerTicket = 6, windowMinutes = 45 } = config;
  const sorted = [...messages].sort((a, b) => getTime(a) - getTime(b));
  const tickets: Ticket[] = [];
  const ticketSources: Record<string, DiscordMessage[]> = {};
  const used = new Set<string>();

  for (let i = 0; i < sorted.length; i++) {
    if (tickets.length >= maxTickets) break;
    const msg = sorted[i];
    if (used.has(msg.id)) continue;
    if (!isTicketCandidate(msg)) continue;

    const context: DiscordMessage[] = [msg];
    const startTime = getTime(msg);
    used.add(msg.id);

    for (let j = i + 1; j < sorted.length; j++) {
      const next = sorted[j];
      if (context.length >= maxMessagesPerTicket) break;
      if (used.has(next.id)) continue;
      const deltaMinutes = Math.abs(getTime(next) - startTime) / (1000 * 60);
      if (deltaMinutes > windowMinutes) break;
      context.push(next);
      used.add(next.id);
    }

    const combinedText = context.map((m) => m.content).join("\n");
    const severity = inferSeverity(combinedText, msg.channel);
    const docCoverage = inferDocCoverage(combinedText);
    const title = buildTitle(msg.content, `Ticket from ${msg.channel}`);
    const summary = buildSummary(combinedText);
    const evidence = buildEvidence(context);
    const affectedItems = extractAffectedItems(context);
    const reasoning = buildReasoning(context, severity, docCoverage);
    const tags = extractKeywords(combinedText);

    const channelKey = (msg.channelId ?? msg.channel).replace(/[^a-z0-9]+/gi, "-");
    const ticketId = `ticket-${channelKey}-${msg.id}`;
    ticketSources[ticketId] = context;
    tickets.push({
      id: ticketId,
      title,
      summary,
      severity,
      docCoverage,
      evidence,
      affectedItems,
      reasoning,
      tags,
      channel: msg.channel,
    });
  }

  return { tickets, edges: [], ticketSources };
};

export const ticketWeight = (ticket: Ticket) =>
  severityWeight[ticket.severity] + Math.min(6, ticket.evidence.length) * 0.6;

export type TicketLLMConfig = OpenAIConfig & {
  maxTickets?: number;
  maxInputChars?: number;
  extraContext?: string;
};

export type TicketLLMRefineStats = {
  attempted: number;
  succeeded: number;
  failed: number;
};

const buildLLMInput = (
  messages: DiscordMessage[],
  maxInputChars: number,
  extraContext?: string,
) => {
  const lines: string[] = [];
  lines.push("Messages:");
  messages.forEach((msg) => {
    const ts = msg.timestamp ?? "unknown time";
    const author = msg.author ?? "unknown";
    const links = msg.links.length ? ` Links: ${msg.links.join(", ")}` : "";
    lines.push(`[${ts}] ${author}: ${msg.content}${links}`);
  });
  const joined = lines.join("\n");
  const contextBlock = extraContext
    ? `\n\nDoc-analyzer context:\n${extraContext}`
    : "";
  if (joined.length + contextBlock.length <= maxInputChars) {
    return `${joined}${contextBlock}`;
  }
  const trimmed = joined.slice(0, Math.max(0, maxInputChars - contextBlock.length));
  return `${trimmed}${contextBlock}`;
};

export const refineTicketsWithLLM = async (
  tickets: Ticket[],
  ticketSources: Record<string, DiscordMessage[]>,
  config: TicketLLMConfig,
): Promise<{ tickets: Ticket[]; stats: TicketLLMRefineStats }> => {
  const { apiKey, model, maxTickets = 12, maxInputChars = 6000, extraContext } = config;
  const refined: Ticket[] = [];
  const stats: TicketLLMRefineStats = { attempted: 0, succeeded: 0, failed: 0 };

  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    if (i >= maxTickets) {
      refined.push(ticket);
      continue;
    }
    const messages = ticketSources[ticket.id] ?? [];
    if (messages.length === 0) {
      refined.push(ticket);
      continue;
    }
    const input = buildLLMInput(messages, maxInputChars, extraContext);
    stats.attempted += 1;
    const result = await createStructuredTicketWithOpenAI({
      apiKey,
      model,
      input,
      channel: ticket.channel ?? "unknown",
    });
    if (!result) {
      stats.failed += 1;
      refined.push(ticket);
      continue;
    }
    stats.succeeded += 1;
    refined.push({
      ...ticket,
      title: result.title,
      summary: result.summary,
      severity: result.severity,
      docCoverage: result.docCoverage,
      affectedItems: result.affectedItems,
      reasoning: result.reasoning ?? ticket.reasoning,
      tags: result.tags ?? ticket.tags,
    });
  }

  return { tickets: refined, stats };
};
