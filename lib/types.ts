export type ChunkId = string;

export type SourceType =
  | "github:pr"
  | "github:issue"
  | "discord:ticket"
  | "slack"
  | "code"
  | "ticket"
  | "doc";

export interface Chunk {
  id: ChunkId;
  title: string;
  summary: string;
  sourceType: SourceType;
  sourceRef?: string;
  weight: number;
  component?: string;
  tags?: string[];
  activityScore?: number;
  createdAt?: string;
  updatedAt?: string;
  ticket?: Ticket;
}

export interface Edge {
  from: ChunkId;
  to: ChunkId;
  rationale?: string;
}

export interface Signal {
  id: string;
  chunkId: ChunkId;
  type: "commit" | "issue" | "discussion" | "doc";
  title: string;
  url?: string;
  ts: string;
  meta?: Record<string, unknown>;
}

export interface DiscordMessage {
  id: string;
  channel: string;
  channelId?: string;
  author?: string;
  timestamp?: string;
  content: string;
  links: string[];
  file: string;
  url?: string;
}

export interface TicketEvidence {
  messageId: string;
  channel: string;
  snippet: string;
  url?: string;
  author?: string;
  timestamp?: string;
}

export type TicketSeverity = "low" | "medium" | "high" | "critical";
export type TicketDocCoverage = "missing" | "partial" | "adequate" | "unknown";

export interface Ticket {
  id: string;
  title: string;
  summary: string;
  severity: TicketSeverity;
  docCoverage: TicketDocCoverage;
  evidence: TicketEvidence[];
  affectedItems?: string[];
  reasoning?: string;
  tags?: string[];
  channel?: string;
}

export interface Graph {
  chunks: Record<ChunkId, Chunk>;
  edges: Edge[];
}

export interface ClosureSolution {
  closure: ChunkId[];
  totalWeight: number;
  size: number;
  penalty?: number;
}
