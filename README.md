# Sliding Context Window

Next.js prototype that turns multi-source activity (code, issues, chat) into a weighted DAG of documentation chunks and uses an optimal-closure solver to pick the most valuable, self-contained context for updates or LLM prompts.

## Running locally
1) `npm install`  
2) Ensure `python3` is available on PATH (used by the closure solver).  
3) `npm run dev` (API routes: `/api/closure`, `/api/ingest`)  
Optional: `GITHUB_TOKEN=<token> npm run dev` for higher GitHub rate limits when hitting `/api/ingest?repo=owner/name` (unauthenticated works but is limited to 60/hr).

## Principal data model
- `Chunk`: bounded piece of context (id, title, summary, sourceType, weight, component, tags, timestamps, sourceRef).
- `Edge`: directed dependency `from -> to` meaning `from` relies on `to`; closures must include all dependencies.
- `Signal` (for ingestion): raw events such as GitHub issues/PRs, commits, Slack threads.
- `Graph`: `{ chunks: Record<id, Chunk>; edges: Edge[] }`.

## Optimal-closure solver
- Implemented in Python (`scripts/closure_solver.py`) and invoked from Node via `lib/closure.ts`.  
- Classic reduction of maximum-weight closure to s-t min-cut (Dinic). Positive `(weight - penalty)` edges go `source -> node`; negatives go `node -> sink`; dependency edges carry effectively infinite capacity. Nodes reachable from source form the closure.  
- `maximumWeightClosure(graph)`: unconstrained optimum.  
- `solveClosureBySize(graph, k)`: binary searches a per-node penalty to steer the closure toward size `k` (keeps dependency closure intact).  
- Post-processed to enforce target size deterministically; edges are preserved and layout is deterministic.

## Ingestion
- GitHub issues/PRs (live): `/api/ingest?repo=owner/name&size=4` uses `GITHUB_TOKEN` if present; unauthenticated is 60/hr. Fetches all open issues, falls back to open PRs if issues are empty. Chunks are built from the list; weights are derived from comments + reactions for a simple v0 signal.
- Discord exports (local): `POST /api/discord/ingest` reads `LanceDB-DiscordExport/*.html`, samples a bounded subset of messages, and turns them into structured tickets (graph + prompt). `GET /api/discord/channels` lists available channels; `GET /api/discord/export?file=...` serves the original HTML for evidence links.
- LLM refinement (optional): set `OPENAI_API_KEY` and pass `useLLM: true` (with optional `model`, `llmTicketLimit`, `llmMaxInputChars`) to `/api/discord/ingest` to have OpenAI refine ticket summaries.

## Query surface
- `/api/closure?size=4`: POST a graph to this endpoint to run the solver. GET will respond with an error (no default graph).  
- `/api/ingest?repo=owner/name&size=4`: pull GitHub issues into a graph and (optionally) solve closure for a target size. If issues are empty, falls back to open PRs; if both are empty, returns an empty graph/closure. Supports unauthenticated (60/hr) and uses `GITHUB_TOKEN` when present.  
- UI (`app/page.tsx`): fetch chunks (issues/PRs), view an interactive graph (pan/zoom; click node for details; deterministic layout), solve closure for k (selected nodes highlighted), and view only the selected chunk details below.


## Generalization
The same machinery works beyond LLM context: interpret chunks as tasks, weights as project utility, and `k` as available resources; the closure solver then selects the highest-value self-contained project slice. This prototype focuses on the documentation use case but keeps the solver/general structure reusable.
