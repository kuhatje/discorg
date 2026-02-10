"use client";

import { useEffect, useMemo, useState } from "react";
import { Chunk, Graph, Ticket } from "@/lib/types";
import GraphViewer from "@/app/components/GraphViewer";

type ChannelMeta = {
  file: string;
  channel: string;
  channelId?: string;
  category?: string;
  label: string;
};

type IngestResponse = {
  graph: Graph;
  tickets: Ticket[];
  prompt: string;
  channels: string[];
  messageCount: number;
  sampledMessageCount?: number;
  ticketCount: number;
  evidenceMessageCount?: number;
  updatedAt?: string;
  newTicketsAdded?: number;
  oqoqoContextIncluded?: boolean;
  oqoqoContextError?: string;
  error?: string;
};

type SeverityStyle = {
  bg: string;
  fg: string;
  border: string;
  fontWeight?: number;
};

const severityStyles: Record<string, SeverityStyle> = {
  low: { bg: "var(--card-strong)", fg: "#6b7280", border: "var(--border)" },
  medium: { bg: "var(--card-strong)", fg: "#4b5563", border: "var(--border-strong)" },
  high: { bg: "var(--card-strong)", fg: "#374151", border: "var(--border-strong)" },
  critical: { bg: "var(--card-strong)", fg: "#111827", border: "#9ca3af", fontWeight: 600 },
};

export default function DiscordRunner() {
  const [channels, setChannels] = useState<ChannelMeta[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [maxMessagesTotal, setMaxMessagesTotal] = useState(400);
  const [maxMessagesPerChannel, setMaxMessagesPerChannel] = useState(120);
  const [maxCharsPerMessage, setMaxCharsPerMessage] = useState(800);
  const [maxTickets, setMaxTickets] = useState(60);
  const [maxMessagesPerTicket, setMaxMessagesPerTicket] = useState(6);
  const [windowMinutes, setWindowMinutes] = useState(45);
  const [sampleStrategy, setSampleStrategy] = useState<"recent" | "random">("recent");
  const [useLLM, setUseLLM] = useState(false);
  const [includeOqoqoContext, setIncludeOqoqoContext] = useState(false);
  const [model, setModel] = useState("gpt-4o-mini");
  const [llmTicketLimit, setLlmTicketLimit] = useState(12);
  const [llmMaxInputChars, setLlmMaxInputChars] = useState(6000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResponse | null>(null);
  const [activeChunk, setActiveChunk] = useState<Chunk | null>(null);
  const [showReasoning, setShowReasoning] = useState(false);

  useEffect(() => {
    const loadChannels = async () => {
      const res = await fetch("/api/discord/channels");
      const json = (await res.json()) as { channels: ChannelMeta[] };
      setChannels(json.channels ?? []);
      const initial = new Set((json.channels ?? []).slice(0, 4).map((c) => c.file));
      setSelected(initial);
    };
    loadChannels().catch(() => setChannels([]));
  }, []);

  useEffect(() => {
    const loadPersisted = async () => {
      const res = await fetch("/api/discord/state");
      if (!res.ok) return;
      const json = (await res.json()) as IngestResponse;
      if (json?.tickets?.length) {
        setResult(json);
      }
    };
    loadPersisted().catch(() => null);
  }, []);

  const selectedChannels = useMemo(() => {
    return channels.filter((c) => selected.has(c.file));
  }, [channels, selected]);

  const ticketsById = useMemo(() => {
    const map = new Map<string, Ticket>();
    result?.tickets?.forEach((ticket) => map.set(ticket.id, ticket));
    return map;
  }, [result]);

  const runIngest = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/discord/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channels: [...selected],
          maxMessagesTotal,
          maxMessagesPerChannel,
          maxCharsPerMessage,
          maxTickets,
          maxMessagesPerTicket,
          windowMinutes,
          sampleStrategy,
          useLLM,
          model,
          llmTicketLimit,
          llmMaxInputChars,
          includeOqoqoContext,
        }),
      });
      const json = (await res.json()) as IngestResponse;
      if (!res.ok || json.error) {
        setError(json.error ?? "Request failed.");
      } else {
        setResult(json);
      }
    } catch (err: any) {
      setError(err?.message ?? "Unknown error.");
    } finally {
      setLoading(false);
    }
  };

  const buttonSecondary = {
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid var(--border-strong)",
    background: "#f3f4f6",
    color: "var(--foreground)",
    cursor: "pointer",
  } as const;

  const inputBase = {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--border-strong)",
    background: "var(--card-strong)",
    color: "var(--foreground)",
  } as const;

  return (
    <section id="tickets" className="card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: "0 0 6px 0" }}>Discord ingestion</h2>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            Sample exported Discord channels and generate structured tickets. Optional OpenAI refinement.
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" onClick={() => setSelected(new Set(channels.map((c) => c.file)))} style={buttonSecondary}>
            Select all
          </button>
          <button type="button" onClick={() => setSelected(new Set())} style={buttonSecondary}>
            Clear
          </button>
          <button
            type="button"
            onClick={async () => {
              await fetch("/api/discord/state", { method: "DELETE" });
              setResult(null);
            }}
            style={buttonSecondary}
          >
            Clear saved
          </button>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            {selected.size} / {channels.length} channels selected
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 8,
            maxHeight: 220,
            overflow: "auto",
            padding: 8,
            border: "1px solid var(--border)",
            borderRadius: 10,
            background: "var(--card-strong)",
          }}
        >
          {channels.map((channel) => {
            const checked = selected.has(channel.file);
            return (
              <label
                key={channel.file}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (checked) next.delete(channel.file);
                      else next.add(channel.file);
                      return next;
                    });
                  }}
                />
                <span>{channel.label}</span>
              </label>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            Max messages total
            <input
              type="number"
              value={maxMessagesTotal}
              min={50}
              onChange={(e) => setMaxMessagesTotal(Number.parseInt(e.target.value, 10) || 0)}
              style={{ ...inputBase, width: 160 }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            Max per channel
            <input
              type="number"
              value={maxMessagesPerChannel}
              min={10}
              onChange={(e) => setMaxMessagesPerChannel(Number.parseInt(e.target.value, 10) || 0)}
              style={{ ...inputBase, width: 160 }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            Max chars/message
            <input
              type="number"
              value={maxCharsPerMessage}
              min={200}
              onChange={(e) => setMaxCharsPerMessage(Number.parseInt(e.target.value, 10) || 0)}
              style={{ ...inputBase, width: 160 }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            Max tickets
            <input
              type="number"
              value={maxTickets}
              min={10}
              onChange={(e) => setMaxTickets(Number.parseInt(e.target.value, 10) || 0)}
              style={{ ...inputBase, width: 120 }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            Messages/ticket
            <input
              type="number"
              value={maxMessagesPerTicket}
              min={2}
              onChange={(e) => setMaxMessagesPerTicket(Number.parseInt(e.target.value, 10) || 0)}
              style={{ ...inputBase, width: 120 }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            Window (mins)
            <input
              type="number"
              value={windowMinutes}
              min={5}
              onChange={(e) => setWindowMinutes(Number.parseInt(e.target.value, 10) || 0)}
              style={{ ...inputBase, width: 120 }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            Sample strategy
            <select
              value={sampleStrategy}
              onChange={(e) => setSampleStrategy(e.target.value as "recent" | "random")}
              style={{ ...inputBase, width: 160 }}
            >
              <option value="recent">Recent</option>
              <option value="random">Random</option>
            </select>
          </label>
        </div>

        <div
          style={{
            display: "grid",
            gap: 8,
            padding: 12,
            border: "1px solid var(--border)",
            borderRadius: 10,
            background: "var(--card)",
          }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={useLLM} onChange={() => setUseLLM((prev) => !prev)} />
            Use OpenAI to refine tickets
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={includeOqoqoContext}
              onChange={() => setIncludeOqoqoContext((prev) => !prev)}
            />
            Include doc-analyzer context (~/Desktop/oqoqo)
          </label>
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              opacity: useLLM ? 1 : 0.5,
            }}
          >
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              Model
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={!useLLM}
                style={{ ...inputBase, width: 180 }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              LLM ticket limit
              <input
                type="number"
                value={llmTicketLimit}
                min={1}
                onChange={(e) => setLlmTicketLimit(Number.parseInt(e.target.value, 10) || 0)}
                disabled={!useLLM}
                style={{ ...inputBase, width: 140 }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              LLM max input chars
              <input
                type="number"
                value={llmMaxInputChars}
                min={1000}
                onChange={(e) => setLlmMaxInputChars(Number.parseInt(e.target.value, 10) || 0)}
                disabled={!useLLM}
                style={{ ...inputBase, width: 160 }}
              />
            </label>
            <span style={{ fontSize: 12, color: "var(--muted)", alignSelf: "flex-end" }}>
              Requires OPENAI_API_KEY in the server environment.
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            disabled={loading || selected.size === 0}
            onClick={runIngest}
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              border: "1px solid var(--accent)",
              background: "var(--accent)",
              color: "var(--accent-contrast)",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {loading ? "Working..." : "Generate tickets"}
          </button>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            {selectedChannels.length > 0
              ? `Using ${selectedChannels.length} channels (${selectedChannels
                  .slice(0, 3)
                  .map((c) => c.channel)
                  .join(", ")}${selectedChannels.length > 3 ? "..." : ""}).`
              : "Select channels to begin."}
          </span>
        </div>
      </div>

      {error ? <div style={{ color: "#b91c1c", marginTop: 12 }}>{error}</div> : null}

      {result ? (
        <div className="grid" style={{ gap: 16, marginTop: 16 }}>
          <div id="graph">
            <GraphViewer
              graph={result.graph}
              onSelectChunk={(chunk) => setActiveChunk(chunk)}
            />
          </div>

          <div className="card" style={{ background: "var(--card)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div>
                <strong>Channels:</strong> {result.channels.join(", ")}
              </div>
              <div>
                <strong>Messages:</strong> {result.messageCount}
                {typeof result.sampledMessageCount === "number" ? (
                  <span style={{ marginLeft: 8, color: "var(--muted)", fontSize: 12 }}>(sampled {result.sampledMessageCount})</span>
                ) : null}
                | <strong>Tickets:</strong>{" "}
                {result.ticketCount}
                {typeof result.newTicketsAdded === "number" ? (
                  <span style={{ marginLeft: 8, color: "var(--muted)", fontSize: 12 }}>(+{result.newTicketsAdded} new)</span>
                ) : null}
              </div>
              {result.updatedAt ? (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Last saved: {new Date(result.updatedAt).toLocaleString()}</div>
              ) : null}
              {typeof result.oqoqoContextIncluded === "boolean" || result.oqoqoContextError ? (
                <div style={{ fontSize: 12, color: result.oqoqoContextError ? "#b91c1c" : "var(--muted)" }}>
                  <strong>Doc-analyzer context:</strong>{" "}
                  {result.oqoqoContextError
                    ? `unavailable (${result.oqoqoContextError})`
                    : result.oqoqoContextIncluded
                      ? "included"
                      : "not included"}
                </div>
              ) : null}
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)" }}>
              <input
                type="checkbox"
                checked={showReasoning}
                onChange={() => setShowReasoning((prev) => !prev)}
              />
              Show background reasoning
            </label>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            {result.tickets.map((ticket) => {
              const style = severityStyles[ticket.severity] ?? severityStyles.low;
              return (
                <div
                  key={ticket.id}
                  className="card"
                  style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 240, background: "var(--card)" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span
                      style={{
                        background: style.bg,
                        color: style.fg,
                        padding: "2px 8px",
                        borderRadius: 999,
                        fontSize: 11,
                        textTransform: "uppercase",
                        border: `1px solid ${style.border}`,
                        fontWeight: style.fontWeight ?? 500,
                      }}
                    >
                      {ticket.severity}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{ticket.docCoverage}</span>
                  </div>
                  <h3 style={{ margin: "4px 0 0 0", lineHeight: 1.3 }}>{ticket.title}</h3>
                  <p style={{ marginTop: 4, color: "rgba(26, 26, 26, 0.85)", lineHeight: 1.45 }}>{ticket.summary}</p>
                  {ticket.affectedItems?.length ? (
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      Affected: {ticket.affectedItems.slice(0, 2).join(", ")}
                    </div>
                  ) : null}
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>Evidence</div>
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "rgba(26, 26, 26, 0.85)" }}>
                    {ticket.evidence.slice(0, 3).map((ev) => (
                      <li key={ev.messageId}>
                        {ev.url ? (
                          <a href={ev.url} target="_blank" rel="noreferrer" style={{ color: "var(--link)" }}>
                            {ev.channel}: {ev.snippet}
                          </a>
                        ) : (
                          `${ev.channel}: ${ev.snippet}`
                        )}
                      </li>
                    ))}
                  </ul>
                  {showReasoning && ticket.reasoning ? (
                    <p style={{ fontSize: 12, color: "var(--muted)" }}>{ticket.reasoning}</p>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div id="prompt" className="card" style={{ background: "var(--card)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <strong>LLM prompt</strong>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                Includes background reasoning for downstream analysis.
              </span>
            </div>
            <textarea
              readOnly
              value={result.prompt}
              style={{
                marginTop: 10,
                width: "100%",
                minHeight: 200,
                padding: 12,
                borderRadius: 10,
                border: "1px solid var(--border-strong)",
                background: "var(--card-strong)",
                color: "var(--foreground)",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            />
          </div>
        </div>
      ) : (
        <p style={{ color: "var(--muted)", marginTop: 12 }}>Select channels and generate tickets.</p>
      )}

      {activeChunk ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
          onClick={() => setActiveChunk(null)}
        >
          <div
            className="card"
            style={{
              maxWidth: 560,
              maxHeight: "80vh",
              overflow: "auto",
              background: "var(--card-strong)",
              boxShadow: "var(--shadow-lg)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase" }}>
              {activeChunk.sourceType}
            </div>
            <h3 style={{ margin: "4px 0 0 0", lineHeight: 1.3 }}>{activeChunk.title}</h3>
            <p style={{ marginTop: 8, color: "rgba(26, 26, 26, 0.85)", lineHeight: 1.45 }}>{activeChunk.summary}</p>
            {activeChunk.ticket ? (
              <div style={{ marginTop: 12, fontSize: 13 }}>
                <div>
                  <strong>Severity:</strong> {activeChunk.ticket.severity}
                </div>
                <div>
                  <strong>Documentation coverage:</strong> {activeChunk.ticket.docCoverage}
                </div>
                {activeChunk.ticket.affectedItems?.length ? (
                  <div>
                    <strong>Affected items:</strong> {activeChunk.ticket.affectedItems.join(", ")}
                  </div>
                ) : null}
                {showReasoning && activeChunk.ticket.reasoning ? (
                  <p style={{ marginTop: 8, color: "var(--muted)" }}>{activeChunk.ticket.reasoning}</p>
                ) : null}
              </div>
            ) : null}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
                marginTop: 12,
              }}
            >
              <span>Channel: {activeChunk.component ?? "n/a"}</span>
              <strong>Weight {activeChunk.weight.toFixed(1)}</strong>
            </div>
            {activeChunk.sourceRef ? (
              <a
                href={activeChunk.sourceRef}
                target="_blank"
                rel="noreferrer"
                style={{ display: "block", marginTop: 12, color: "var(--link)" }}
              >
                View evidence
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
