"use client";

import { useEffect, useMemo, useState } from "react";
import { Chunk, ClosureSolution, Graph, Ticket } from "@/lib/types";
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
  ticketCount: number;
  error?: string;
};

const severityStyles: Record<string, { bg: string; fg: string }> = {
  low: { bg: "#1f2937", fg: "#e2e8f0" },
  medium: { bg: "#f59e0b", fg: "#111827" },
  high: { bg: "#f97316", fg: "#0b1221" },
  critical: { bg: "#ef4444", fg: "#0b1221" },
};

const chunkListFromClosure = (graph: Graph, closure: ClosureSolution) =>
  closure.closure
    .map((id) => graph.chunks[id])
    .filter(Boolean)
    .sort((a, b) => b.weight - a.weight);

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
  const [model, setModel] = useState("gpt-4o-mini");
  const [llmTicketLimit, setLlmTicketLimit] = useState(12);
  const [llmMaxInputChars, setLlmMaxInputChars] = useState(6000);
  const [loading, setLoading] = useState(false);
  const [solving, setSolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResponse | null>(null);
  const [activeChunk, setActiveChunk] = useState<Chunk | null>(null);
  const [k, setK] = useState(10);
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

  const selectedChannels = useMemo(() => {
    return channels.filter((c) => selected.has(c.file));
  }, [channels, selected]);

  const ticketsById = useMemo(() => {
    const map = new Map<string, Ticket>();
    result?.tickets?.forEach((ticket) => map.set(ticket.id, ticket));
    return map;
  }, [result]);

  const [closure, setClosure] = useState<ClosureSolution | null>(null);

  const closureTickets = useMemo(() => {
    if (!result?.graph || !closure) return [];
    return chunkListFromClosure(result.graph, closure);
  }, [result, closure]);

  const runIngest = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setClosure(null);
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

  const runSolve = async () => {
    if (!result?.graph) {
      setError("Generate tickets first.");
      return;
    }
    setSolving(true);
    setError(null);
    try {
      const res = await fetch("/api/closure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size: k, graph: result.graph }),
      });
      const json = (await res.json()) as { closure?: ClosureSolution; error?: string };
      if (!res.ok || json.error || !json.closure) {
        setError(json.error ?? "Closure solve failed.");
      } else {
        setClosure(json.closure ?? null);
      }
    } catch (err: any) {
      setError(err?.message ?? "Unknown error.");
    } finally {
      setSolving(false);
    }
  };

  return (
    <section className="card">
      <h2 style={{ margin: "0 0 10px 0" }}>Ingest LanceDB Discord exports</h2>
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            onClick={() => setSelected(new Set(channels.map((c) => c.file)))}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #1f2937",
              background: "#111827",
              color: "#e2e8f0",
              cursor: "pointer",
            }}
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #1f2937",
              background: "#111827",
              color: "#e2e8f0",
              cursor: "pointer",
            }}
          >
            Clear
          </button>
          <span style={{ opacity: 0.8 }}>
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
            border: "1px solid #1f2937",
            borderRadius: 10,
            background: "#0b1221",
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
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #1f2937",
                background: "#0b1221",
                color: "#e2e8f0",
                width: 160,
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            Max per channel
            <input
              type="number"
              value={maxMessagesPerChannel}
              min={10}
              onChange={(e) => setMaxMessagesPerChannel(Number.parseInt(e.target.value, 10) || 0)}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #1f2937",
                background: "#0b1221",
                color: "#e2e8f0",
                width: 160,
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            Max chars/message
            <input
              type="number"
              value={maxCharsPerMessage}
              min={200}
              onChange={(e) => setMaxCharsPerMessage(Number.parseInt(e.target.value, 10) || 0)}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #1f2937",
                background: "#0b1221",
                color: "#e2e8f0",
                width: 160,
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            Max tickets
            <input
              type="number"
              value={maxTickets}
              min={10}
              onChange={(e) => setMaxTickets(Number.parseInt(e.target.value, 10) || 0)}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #1f2937",
                background: "#0b1221",
                color: "#e2e8f0",
                width: 120,
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            Messages/ticket
            <input
              type="number"
              value={maxMessagesPerTicket}
              min={2}
              onChange={(e) => setMaxMessagesPerTicket(Number.parseInt(e.target.value, 10) || 0)}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #1f2937",
                background: "#0b1221",
                color: "#e2e8f0",
                width: 120,
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            Window (mins)
            <input
              type="number"
              value={windowMinutes}
              min={5}
              onChange={(e) => setWindowMinutes(Number.parseInt(e.target.value, 10) || 0)}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #1f2937",
                background: "#0b1221",
                color: "#e2e8f0",
                width: 120,
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            Sample strategy
            <select
              value={sampleStrategy}
              onChange={(e) => setSampleStrategy(e.target.value as "recent" | "random")}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #1f2937",
                background: "#0b1221",
                color: "#e2e8f0",
              }}
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
            border: "1px solid #1f2937",
            borderRadius: 10,
            background: "#0f172a",
          }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={useLLM} onChange={() => setUseLLM((prev) => !prev)} />
            Use OpenAI to refine tickets
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
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #1f2937",
                  background: "#0b1221",
                  color: "#e2e8f0",
                  width: 180,
                }}
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
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #1f2937",
                  background: "#0b1221",
                  color: "#e2e8f0",
                  width: 140,
                }}
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
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #1f2937",
                  background: "#0b1221",
                  color: "#e2e8f0",
                  width: 160,
                }}
              />
            </label>
            <span style={{ fontSize: 12, opacity: 0.7, alignSelf: "flex-end" }}>
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
              border: "1px solid #1f2937",
              background: "#0ea5e9",
              color: "#0b1221",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {loading ? "Working..." : "Generate tickets"}
          </button>
          <span style={{ opacity: 0.7 }}>
            {selectedChannels.length > 0
              ? `Using ${selectedChannels.length} channels (${selectedChannels
                  .slice(0, 3)
                  .map((c) => c.channel)
                  .join(", ")}${selectedChannels.length > 3 ? "..." : ""}).`
              : "Select channels to begin."}
          </span>
        </div>
      </div>

      {error ? <div style={{ color: "#fca5a5", marginTop: 12 }}>{error}</div> : null}

      {result ? (
        <div className="grid" style={{ gap: 16, marginTop: 16 }}>
          <GraphViewer
            graph={result.graph}
            selectedIds={closure ? new Set(closure.closure) : undefined}
            onSelectChunk={(chunk) => setActiveChunk(chunk)}
          />

          <div className="card" style={{ background: "#0f172a" }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div>
                <strong>Channels:</strong> {result.channels.join(", ")}
              </div>
              <div>
                <strong>Messages:</strong> {result.messageCount} | <strong>Tickets:</strong>{" "}
                {result.ticketCount}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              value={k > 0 ? String(k) : ""}
              onChange={(e) => {
                const val = e.target.value;
                if (val === "") {
                  setK(0);
                  return;
                }
                const parsed = Number.parseInt(val, 10);
                if (!Number.isNaN(parsed) && parsed > 0) {
                  setK(parsed);
                }
              }}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #1f2937",
                background: "#0b1221",
                color: "#e2e8f0",
                width: 120,
              }}
              placeholder="Enter k"
              disabled={solving}
            />
            <button
              type="button"
              disabled={solving}
              onClick={runSolve}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: "1px solid #1f2937",
                background: "#111827",
                color: "#e2e8f0",
                fontWeight: 600,
                cursor: solving ? "wait" : "pointer",
              }}
            >
              {solving ? "Solving..." : "Solve closure"}
            </button>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={showReasoning}
                onChange={() => setShowReasoning((prev) => !prev)}
              />
              Show background reasoning
            </label>
          </div>

          {closure ? (
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
              {closureTickets.map((chunk) => {
                const ticket = ticketsById.get(chunk.id);
                const severity = ticket?.severity ?? "low";
                const style = severityStyles[severity] ?? severityStyles.low;
                return (
                  <div
                    key={chunk.id}
                    className="card"
                    style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 220 }}
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
                        }}
                      >
                        {severity}
                      </span>
                      <span style={{ fontSize: 12, opacity: 0.7 }}>{ticket?.docCoverage ?? "unknown"}</span>
                    </div>
                    <h3 style={{ margin: "4px 0 0 0", lineHeight: 1.3 }}>{chunk.title}</h3>
                    <p
                      style={{
                        marginTop: 4,
                        opacity: 0.85,
                        lineHeight: 1.45,
                        display: "-webkit-box",
                        WebkitLineClamp: 5,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {chunk.summary}
                    </p>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>Evidence: {ticket?.evidence.length ?? 0}</div>
                    {showReasoning && ticket?.reasoning ? (
                      <p style={{ fontSize: 12, opacity: 0.7 }}>{ticket.reasoning}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p style={{ opacity: 0.8 }}>Solve closure to view the top-k ticket details.</p>
          )}

          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            {result.tickets.map((ticket) => {
              const style = severityStyles[ticket.severity] ?? severityStyles.low;
              return (
                <div
                  key={ticket.id}
                  className="card"
                  style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 240 }}
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
                      }}
                    >
                      {ticket.severity}
                    </span>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>{ticket.docCoverage}</span>
                  </div>
                  <h3 style={{ margin: "4px 0 0 0", lineHeight: 1.3 }}>{ticket.title}</h3>
                  <p style={{ marginTop: 4, opacity: 0.85, lineHeight: 1.45 }}>{ticket.summary}</p>
                  {ticket.affectedItems?.length ? (
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      Affected: {ticket.affectedItems.slice(0, 2).join(", ")}
                    </div>
                  ) : null}
                  <div style={{ fontSize: 12, opacity: 0.7 }}>Evidence</div>
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, opacity: 0.8 }}>
                    {ticket.evidence.slice(0, 3).map((ev) => (
                      <li key={ev.messageId}>
                        {ev.url ? (
                          <a href={ev.url} target="_blank" rel="noreferrer" style={{ color: "#38bdf8" }}>
                            {ev.channel}: {ev.snippet}
                          </a>
                        ) : (
                          `${ev.channel}: ${ev.snippet}`
                        )}
                      </li>
                    ))}
                  </ul>
                  {showReasoning && ticket.reasoning ? (
                    <p style={{ fontSize: 12, opacity: 0.7 }}>{ticket.reasoning}</p>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="card" style={{ background: "#0f172a" }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <strong>LLM prompt</strong>
              <span style={{ fontSize: 12, opacity: 0.7 }}>
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
                border: "1px solid #1f2937",
                background: "#0b1221",
                color: "#e2e8f0",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            />
          </div>
        </div>
      ) : (
        <p style={{ opacity: 0.8, marginTop: 12 }}>Select channels and generate tickets.</p>
      )}

      {activeChunk ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
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
              background: "#0f172a",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 12, opacity: 0.7, textTransform: "uppercase" }}>
              {activeChunk.sourceType}
            </div>
            <h3 style={{ margin: "4px 0 0 0", lineHeight: 1.3 }}>{activeChunk.title}</h3>
            <p style={{ marginTop: 8, opacity: 0.85, lineHeight: 1.45 }}>{activeChunk.summary}</p>
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
                  <p style={{ marginTop: 8, opacity: 0.8 }}>{activeChunk.ticket.reasoning}</p>
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
                style={{ display: "block", marginTop: 12, color: "#38bdf8" }}
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
