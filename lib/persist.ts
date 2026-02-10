import fs from "fs/promises";
import path from "path";
import { Edge, Ticket } from "./types";

export type DiscordKnowledgeStore = {
  version: 1;
  updatedAt: string;
  ticketsById: Record<string, Ticket>;
  edges: Edge[];
};

const STORE_DIR = path.join(process.cwd(), "data", "discord");
const STORE_PATH = path.join(STORE_DIR, "knowledge.json");

export const createEmptyDiscordKnowledgeStore = (): DiscordKnowledgeStore => ({
  version: 1,
  updatedAt: new Date().toISOString(),
  ticketsById: {},
  edges: [],
});

const readJsonFile = async <T>(filePath: string): Promise<T | null> => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const loadDiscordKnowledgeStore = async (): Promise<DiscordKnowledgeStore> => {
  const loaded = await readJsonFile<DiscordKnowledgeStore>(STORE_PATH);
  if (!loaded || loaded.version !== 1 || typeof loaded !== "object") {
    return createEmptyDiscordKnowledgeStore();
  }
  return {
    ...createEmptyDiscordKnowledgeStore(),
    ...loaded,
    ticketsById: loaded.ticketsById ?? {},
    edges: loaded.edges ?? [],
  };
};

const writeJsonAtomic = async (filePath: string, data: unknown) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, filePath);
};

const severityRank = (severity: Ticket["severity"]) => {
  switch (severity) {
    case "critical":
      return 3;
    case "high":
      return 2;
    case "medium":
      return 1;
    default:
      return 0;
  }
};

const mergeTicket = (prev: Ticket, next: Ticket): Ticket => {
  const evidenceById = new Map<string, Ticket["evidence"][number]>();
  prev.evidence.forEach((ev) => evidenceById.set(ev.messageId, ev));
  next.evidence.forEach((ev) => evidenceById.set(ev.messageId, ev));
  const evidence = [...evidenceById.values()].sort((a, b) =>
    (a.timestamp ?? "").localeCompare(b.timestamp ?? ""),
  );

  const affectedItems = new Set<string>();
  prev.affectedItems?.forEach((x) => affectedItems.add(x));
  next.affectedItems?.forEach((x) => affectedItems.add(x));

  const tags = new Set<string>();
  prev.tags?.forEach((x) => tags.add(x));
  next.tags?.forEach((x) => tags.add(x));

  const severity =
    severityRank(next.severity) >= severityRank(prev.severity)
      ? next.severity
      : prev.severity;

  const docCoverage = next.docCoverage !== "unknown" ? next.docCoverage : prev.docCoverage;

  return {
    ...prev,
    ...next,
    severity,
    docCoverage,
    evidence,
    affectedItems: affectedItems.size ? [...affectedItems] : undefined,
    tags: tags.size ? [...tags] : undefined,
    reasoning: next.reasoning ?? prev.reasoning,
  };
};

const edgeKey = (edge: Edge) => `${edge.from}::${edge.to}`;

export const mergeDiscordKnowledge = (
  store: DiscordKnowledgeStore,
  incoming: { tickets: Ticket[]; edges?: Edge[] },
): DiscordKnowledgeStore => {
  const nextStore: DiscordKnowledgeStore = {
    ...store,
    ticketsById: { ...store.ticketsById },
    edges: [...store.edges],
  };

  incoming.tickets.forEach((ticket) => {
    const existing = nextStore.ticketsById[ticket.id];
    nextStore.ticketsById[ticket.id] = existing ? mergeTicket(existing, ticket) : ticket;
  });

  const edgeMap = new Map<string, Edge>();
  nextStore.edges.forEach((edge) => edgeMap.set(edgeKey(edge), edge));
  (incoming.edges ?? []).forEach((edge) => {
    const key = edgeKey(edge);
    const prev = edgeMap.get(key);
    if (!prev) {
      edgeMap.set(key, edge);
      return;
    }
    edgeMap.set(key, { ...prev, ...edge, rationale: edge.rationale ?? prev.rationale });
  });
  nextStore.edges = [...edgeMap.values()];
  nextStore.updatedAt = new Date().toISOString();
  return nextStore;
};

export const saveDiscordKnowledgeStore = async (store: DiscordKnowledgeStore) => {
  await writeJsonAtomic(STORE_PATH, store);
};

export const clearDiscordKnowledgeStore = async () => {
  try {
    await fs.unlink(STORE_PATH);
  } catch {
    // ignore
  }
};

export const DISCORD_KNOWLEDGE_STORE_PATH = STORE_PATH;

