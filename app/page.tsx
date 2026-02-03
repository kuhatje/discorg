import DiscordRunner from "@/app/components/DiscordRunner";

export default function HomePage() {
  return (
    <main className="grid" style={{ gap: 20 }}>
      {/* <header className="card" style={{ background: "linear-gradient(135deg, #0ea5e9, #38bdf8)" }}>
        <h1 style={{ margin: 0, color: "#0b1221" }}>Discord Ticket Triage</h1>
        <p style={{ marginTop: 8, color: "#0b1221" }}>
          This prototype ingests the LanceDB Discord export, samples a bounded subset of messages,
          and turns them into structured tickets with evidence, severity, and documentation coverage.
        </p>
        <p style={{ marginTop: 12, color: "#0b1221" }}>
          Tickets are placed in a directed graph (edges optional), with an optimal-closure solver
          kept in the background for later use. The output includes an LLM-ready prompt enriched
          with internal reasoning for downstream analysis.
        </p>
      </header> */}

      <DiscordRunner />
    </main>
  );
}
