"use client";

import { useMemo, useState } from "react";
import { ClosureSolution, Graph, Chunk } from "@/lib/types";
import GraphViewer from "@/app/components/GraphViewer";

type IngestResponse = {
  repo?: string;
  count?: number;
  graph: Graph;
  closure: ClosureSolution | null;
  note?: string;
  error?: string;
  status?: number;
  statusText?: string;
  source?: string;
};

const chunkListFromClosure = (graph: Graph, closure: ClosureSolution) =>
  closure.closure
    .map((id) => graph.chunks[id])
    .filter(Boolean)
    .sort((a, b) => b.weight - a.weight);

export default function RepoRunner() {
  const [repo, setRepo] = useState("");
  const [k, setK] = useState(10);
  const [loading, setLoading] = useState(false);
  const [solving, setSolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResponse | null>(null);
  const [activeChunk, setActiveChunk] = useState<Chunk | null>(null);

  const closureChunks = useMemo(() => {
    if (!result || !result.closure) return [];
    return chunkListFromClosure(result.graph, result.closure);
  }, [result]);

  const allChunks = useMemo(() => {
    if (!result) return [];
    return Object.values(result.graph?.chunks ?? {}).sort((a, b) => b.weight - a.weight);
  }, [result]);

  const runIngest = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const params = new URLSearchParams({
        repo,
        solve: "false",
      });
      const res = await fetch(`/api/ingest?${params.toString()}`, { cache: "no-store" });
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
      setError("Fetch chunks first.");
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
        const closurePayload: ClosureSolution | null = json.closure ?? null;
        setResult((prev) => (prev ? { ...prev, closure: closurePayload } : prev));
      }
    } catch (err: any) {
      setError(err?.message ?? "Unknown error.");
    } finally {
      setSolving(false);
    }
  };

  return (
    <section className="card">
      <h2 style={{ margin: "0 0 10px 0" }}>Run on a GitHub repo</h2>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder="owner/name"
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #1f2937",
            background: "#0b1221",
            color: "#e2e8f0",
            minWidth: 220,
          }}
        />
        <button
          type="button"
          disabled={loading}
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
          {loading ? "Working..." : "Fetch chunks"}
        </button>
      </div>

      {result?.graph ? (
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
            marginTop: 12,
          }}
        >
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
        </div>
      ) : null}
      <p style={{ opacity: 0.75, marginTop: 8, marginBottom: 12 }}>
        {/* Works without `GITHUB_TOKEN` (subject to 60/hr unauthenticated GitHub limits). Fetches all open issues (or PRs if issues are empty) across all pages; solve closure for k after fetching. */}
      </p>

      {error ? (
        <div style={{ color: "#fca5a5" }}>{error}</div>
      ) : result ? (
        <div className="grid" style={{ gap: 12 }}>
          <GraphViewer
            graph={result.graph}
            selectedIds={result.closure ? new Set(result.closure.closure) : undefined}
            onSelectChunk={(chunk) => setActiveChunk(chunk)}
          />

          <div className="card" style={{ background: "#0f172a" }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div>
                <strong>Repo:</strong> {result.repo ?? "mock"} | <strong>Fetched:</strong>{" "}
                {result.count ?? 0} chunks
              </div>
              <div>
                {result.closure ? (
                  <>
                    <strong>Closure:</strong> {result.closure.size} / {result.count ?? 0} |{" "}
                    <strong>Total weight:</strong> {result.closure.totalWeight.toFixed(1)}
                  </>
                ) : (
                  <span style={{ opacity: 0.8 }}>Solve to see closure size/weight.</span>
                )}
              </div>
            </div>
            <p style={{ marginTop: 8, opacity: 0.8 }}>
              Ingested {result.count ?? 0} items {result.source ? `(${result.source})` : "(issues)"}
              . Weights derive from comments and reactions. Selected closure details are listed below, in descending order of weights.
            </p>
            {result.note ? <p style={{ marginTop: 0, opacity: 0.8 }}>{result.note}</p> : null}
          </div>

          {result.closure ? (
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))" }}>
              {closureChunks.map((chunk) => (
                <div
                  key={chunk.id}
                  className="card"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    minHeight: 200,
                  }}
                >
                  <div style={{ fontSize: 12, opacity: 0.7, textTransform: "uppercase" }}>
                    {chunk.sourceType}
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
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 13,
                      marginTop: "auto",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={chunk.component ?? "n/a"}
                    >
                      Component: {chunk.component ?? "n/a"}
                    </span>
                    <strong>Weight {chunk.weight.toFixed(1)}</strong>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ opacity: 0.8 }}>Solve closure to view the top-k chunk details.</p>
          )}
        </div>
      ) : (
        <p style={{ opacity: 0.8 }}>Submit a public repo to run ingestion and closure selection.</p>
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
              maxWidth: 520,
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
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
                marginTop: 12,
              }}
            >
              <span>Component: {activeChunk.component ?? "n/a"}</span>
              <strong>Weight {activeChunk.weight.toFixed(1)}</strong>
            </div>
            {activeChunk.sourceRef ? (
              <a
                href={activeChunk.sourceRef}
                target="_blank"
                rel="noreferrer"
                style={{ display: "block", marginTop: 12, color: "#38bdf8" }}
              >
                View source
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
