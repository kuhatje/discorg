import fs from "fs/promises";
import path from "path";
import { DiscordMessage } from "./types";

export type DiscordChannelMeta = {
  file: string;
  channel: string;
  channelId?: string;
  category?: string;
  label: string;
};

export type DiscordSampleConfig = {
  maxMessagesTotal?: number;
  maxMessagesPerChannel?: number;
  maxCharsPerMessage?: number;
  sampleStrategy?: "recent" | "random";
};

export const DISCORD_EXPORT_DIR = path.join(process.cwd(), "LanceDB-DiscordExport");

const decodeHtml = (input: string) => {
  const numeric = input.replace(/&#(\d+);/g, (_, num) => {
    const code = Number.parseInt(num, 10);
    if (Number.isNaN(code)) return _;
    return code > 0xffff ? String.fromCodePoint(code) : String.fromCharCode(code);
  });
  const hex = numeric.replace(/&#x([0-9a-fA-F]+);/g, (_, hexNum) => {
    const code = Number.parseInt(hexNum, 16);
    if (Number.isNaN(code)) return _;
    return code > 0xffff ? String.fromCodePoint(code) : String.fromCharCode(code);
  });
  return hex
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
};

const stripHtml = (input: string) =>
  input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const extractLinks = (input: string): string[] => {
  const links = new Set<string>();
  const hrefRegex = /href=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  for (const match of input.matchAll(hrefRegex)) {
    const link = decodeHtml(match[1] || match[2] || match[3] || "");
    if (link.startsWith("http")) links.add(link);
  }
  const rawRegex = /\bhttps?:\/\/[^\s<]+/gi;
  for (const match of input.matchAll(rawRegex)) {
    const link = decodeHtml(match[0]);
    if (link.startsWith("http")) links.add(link);
  }
  return [...links];
};

export const parseChannelMetaFromFilename = (file: string): DiscordChannelMeta => {
  const base = file.replace(/\.html$/i, "");
  const parts = base.split(" - ");
  let category: string | undefined;
  let channelPart = base;
  if (parts.length >= 3) {
    category = parts[1]?.trim();
    channelPart = parts.slice(2).join(" - ").trim();
  } else if (parts.length === 2) {
    channelPart = parts[1].trim();
  }
  const match = channelPart.match(/(.+?)\s*\[(\d+)\]$/);
  const channel = (match ? match[1] : channelPart).trim();
  const channelId = match ? match[2] : undefined;
  const label = category ? `${category} / ${channel}` : channel;
  return { file, channel, channelId, category, label };
};

export const listDiscordExportFiles = async (): Promise<DiscordChannelMeta[]> => {
  const entries = await fs.readdir(DISCORD_EXPORT_DIR).catch(() => []);
  return entries
    .filter((name) => name.toLowerCase().endsWith(".html"))
    .map(parseChannelMetaFromFilename)
    .sort((a, b) => a.label.localeCompare(b.label));
};

const toIso = (value?: string) => {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString();
};

export const parseDiscordExportFile = async (meta: DiscordChannelMeta): Promise<DiscordMessage[]> => {
  const filePath = path.join(DISCORD_EXPORT_DIR, meta.file);
  const html = await fs.readFile(filePath, "utf8");
  const matches = [
    ...html.matchAll(/<div id=["']?chatlog__message-container-(\d+)["']?[^>]*>/g),
  ];
  const messages: DiscordMessage[] = [];
  let lastAuthor: string | undefined;

  for (let i = 0; i < matches.length; i++) {
    const id = matches[i][1];
    const start = matches[i].index ?? 0;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? html.length : html.length;
    const slice = html.slice(start, end);

    const authorMatch = slice.match(/<span class=["']?chatlog__author[^>]*>(.*?)<\/span>/);
    const author = authorMatch ? decodeHtml(stripHtml(authorMatch[1])) : lastAuthor;
    if (author) lastAuthor = author;

    let timestamp: string | undefined;
    const tsMatch = slice.match(/chatlog__timestamp[^>]*title="([^"]+)"/);
    if (tsMatch) {
      timestamp = tsMatch[1];
    } else {
      const shortMatch = slice.match(/chatlog__short-timestamp[^>]*title="([^"]+)"/);
      if (shortMatch) timestamp = shortMatch[1];
    }

    const contentBlocks = [
      ...slice.matchAll(
        /<div class=["']chatlog__content chatlog__markdown["']>([\s\S]*?)<\/div>/g,
      ),
    ].map((m) => m[1]);
    const content = contentBlocks
      .map((block) => {
        const preserveMatch = block.match(
          /<span class=["']?chatlog__markdown-preserve["']?>([\s\S]*?)<\/span>/,
        );
        const inner = preserveMatch ? preserveMatch[1] : block;
        return decodeHtml(stripHtml(inner));
      })
      .join("\n")
      .trim();

    if (!content) continue;
    const links = extractLinks(contentBlocks.join(" "));

    messages.push({
      id,
      channel: meta.label,
      channelId: meta.channelId,
      author,
      timestamp: toIso(timestamp),
      content,
      links,
      file: meta.file,
      url: `/api/discord/export?file=${encodeURIComponent(meta.file)}#chatlog__message-container-${id}`,
    });
  }

  return messages;
};

const hash = (value: string) => {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
};

export const sampleDiscordMessages = (
  messages: DiscordMessage[],
  config: DiscordSampleConfig = {},
): DiscordMessage[] => {
  const {
    maxMessagesTotal = 400,
    maxMessagesPerChannel = 120,
    maxCharsPerMessage = 800,
    sampleStrategy = "recent",
  } = config;

  const grouped = messages.reduce<Map<string, DiscordMessage[]>>((acc, msg) => {
    const bucket = acc.get(msg.channel) ?? [];
    bucket.push(msg);
    acc.set(msg.channel, bucket);
    return acc;
  }, new Map());

  const sampled: DiscordMessage[] = [];
  grouped.forEach((channelMessages) => {
    const sorted = [...channelMessages].sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));
    let slice: DiscordMessage[];
    if (sampleStrategy === "random") {
      slice = sorted
        .map((m) => ({ m, h: hash(m.id + m.content) }))
        .sort((a, b) => a.h - b.h)
        .slice(0, maxMessagesPerChannel)
        .map((entry) => entry.m);
    } else {
      slice = sorted.slice(Math.max(0, sorted.length - maxMessagesPerChannel));
    }
    sampled.push(...slice);
  });

  const withTruncation = sampled.map((msg) => ({
    ...msg,
    content:
      msg.content.length > maxCharsPerMessage
        ? `${msg.content.slice(0, maxCharsPerMessage)}...`
        : msg.content,
  }));

  const sortedAll = withTruncation.sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));
  if (sortedAll.length <= maxMessagesTotal) return sortedAll;

  if (sampleStrategy === "random") {
    return sortedAll
      .map((m) => ({ m, h: hash(m.id + m.content) }))
      .sort((a, b) => a.h - b.h)
      .slice(0, maxMessagesTotal)
      .map((entry) => entry.m);
  }
  return sortedAll.slice(Math.max(0, sortedAll.length - maxMessagesTotal));
};
