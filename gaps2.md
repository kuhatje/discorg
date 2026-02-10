# LanceDB doc gaps


- Validation sources: LanceDB code + in-repo docs as cached by the doc-analyzer
- prioritized recent threads with time window Dec 2025 - Feb 2026


Selection:
1) Start from recent Discord questions that indicate real user confusion or production risk
2) Cross-check current docs (and code) to confirm the behavior and identify what's missing or unclear.
3) Prefer gaps where maintainers can quickly verify and address with a targeted docs patch.             

---

## Gap 1: FTS backend confusion + missing prerequisites (legacy Tantivy path)

Why I picked this
- Recency: Dec 1, 2025.
- Repeated pain pattern: users treat "FTS" as a single feature, but Python has multiple backends/paths; missing docs around prerequisites turns into runtime errors and incorrect expectations.

Discord evidence

> "the docs say that we've moved to native FTS ... but the python package ... still uses tantivy ... tantivy is depreciated"

Docs evidence
- Python `Table.create_fts_index` docs describe `use_tantivy` (legacy vs new), but do not clearly document:
  - that the legacy path requires installing `tantivy` (extra dependency), and
  - that Tantivy-based FTS is local-filesystem-only (explicitly errors otherwise).
  - Citation: `python/python/lancedb/table.py` (docstring for `Table.create_fts_index`).

- JS API reference exposes `Query.fullTextSearch(...)` as a feature but doesn't surface backend constraints.
  - Citation: `docs/src/js/classes/Query.md`.

Code evidence
- Python FTS legacy execution path imports `tantivy` and throws:
  - `ImportError("Please install tantivy-py ...")` if missing.
  - `NotImplementedError("Tantivy-based full text search is only supported on the local filesystem")` on non-local FS.
  - Citation: `python/python/lancedb/query.py` (`LanceFtsQueryBuilder.tantivy_to_arrow`).

Validation argument
- This is a documentation gap (beyond user misunderstanding) because the constraints are enforced as hard runtime errors, but the user-facing docs do not make them clear.
- The Discord message shows the current user mental model is being set by docs phrasing like "native FTS" without clarifying how the legacy path fits



How to validate quickly
1) In a clean Python environment without `tantivy` installed, create/open a table with a Tantivy FTS index and run an FTS query.
2) Confirm the ImportError guidance text.
3) Repeat on a non-local filesystem table (e.g., object store URI) and confirm the NotImplementedError.
4) Verify that the docs site/API reference clearly calls out these constraints where users discover FTS.

---

## Gap 2: Python sync vector search docs omit key `_distance` / refinement semantics (IVF-PQ)

Why I picked this
- Recency: Dec 30, 2025.
- This affects correctness validation: users commonly use `_distance` to threshold results or sanity-check metric behavior.

Discord evidence

> "_distance ... seems to return the l2 distance, regardless of the 'dot' index ... Only when I add .refine(10) ... I get a different _distance value."

Docs evidence (what's missing / inconsistent)
- In the sync Python builder returned by `Table.search()` (`LanceVectorQueryBuilder`), the `refine_factor()` docstring explains reranking more candidates, but omits the key note that `_distance` may be approximate (quantized) when refinement is not used.
  - Citation: `python/python/lancedb/query.py` (`LanceVectorQueryBuilder.refine_factor`).

- In the async Python vector query surface, the `refine_factor()` docstring *does* include the note about `_distance` being approximate unless refined.
  - Citation: `python/python/lancedb/query.py` (`AsyncVectorQuery.refine_factor`).

- JS docs also include the note (so the gap is most acute for Python sync users, which is exactly what the Discord report uses).
  - Citation: `docs/src/js/classes/VectorQuery.md` (`VectorQuery.refineFactor`).

Code evidence (what actually happens)
- Core query docs specify that if refinement is NOT enabled, `_distance` values for IVF-PQ are approximate distances computed from quantized vectors and can differ from the true distance.
  - Citation: `rust/lancedb/src/query.rs` (`Query::refine_factor`).

Validation argument
- This is a documentation gap with a clear paper trail:
  - The behavior is documented correctly in some places (Rust/JS and Python async) but missing from the most common Python API surface (sync `Table.search()`).
  - The Discord report is exactly the confusion you'd expect when users interpret `_distance` as an exact dot/cosine/l2 measure.


How to validate quickly
1) Create a table with an IVF-PQ index with metric = dot and normalized vectors.
2) Run a sync search with `distance_type("dot")` and no refinement; inspect `_distance`.
3) Run the same query with `refine_factor(>1)` and compare `_distance` and ordering.
4) Compare to `bypass_vector_index()` (ground-truth) and document the expected semantics.

---

## Gap 3: "sync vs async indexing" is ambiguous for OSS/native tables

Why I picked this
- Recency: Jan 21, 2026.
- Operational impact: misunderstanding whether `create_index` blocks may lead to bad production code.

Discord evidence
> "Is this ... async connection/table vs sync connection/table, or actually the index will be done in the background ... after calling table.create_index?"

Docs evidence (what's unclear)
- JS `Table.waitForIndex()` is documented as "Waits for asynchronous indexing" but does not explain when/where indexing is asynchronous.
  - Citation: `docs/src/js/classes/Table.md` (`Table.waitForIndex`).

- Python APIs expose `wait_timeout` parameters ("if indexing is asynchronous") but do not clearly scope async indexing to remote tables/backends.
  - Citation: `python/python/lancedb/table.py` (docstrings mentioning `wait_timeout`).

Code evidence
- The Rust IndexBuilder explicitly documents:
  - "This is not supported for NativeTable since indexing is synchronous."
  - Citation: `rust/lancedb/src/index.rs` (`IndexBuilder.wait_timeout`).

Validation argument
- The confusion is reasonable given the docs: multiple surfaces mention async indexing without defining its scope.
- The implementation has a crisp statement that answers the user's question, but that statement isn't surfaced prominently to users.


How to validate quickly
1) For OSS/native tables, confirm `create_index(...).execute()` blocks until completion and that `wait_timeout` is unsupported/ignored.
2) For remote tables, confirm index creation can be asynchronous and that `waitForIndex` / `wait_timeout` is meaningful.
3) Update the docs wording to explicitly scope "async indexing" to remote backends (or specify the exact conditions).

---


## Gap 4: Index caching guidance missing (prewarm_index vs read_consistency_interval)

Why I picked this
- Recency: Dec 13, 2025.
- The question is specific, operational, and still not clearly answered in docs.

Discord evidence
> "is there an in depth guide to how caching indexes works in lancedb? Like what's the relationship between prewarm_index and read_consistency_interval?"

Docs evidence (what's missing)
- `Table.prewarmIndex()` docs only describe loading an index into memory; no explanation of cache layers, sizing, or interaction with consistency settings.
  - Citation: `docs/src/js/classes/Table.md`.

- `readConsistencyInterval` describes periodic consistency checks but does not relate to caching or prewarming.
  - Citation: `docs/src/js/interfaces/ConnectionOptions.md`.

Code evidence (what actually happens)
- `ReadConsistency` is a database-level consistency policy; `prewarm_index` is a distinct API that only loads index data into memory.
  - Citation: `rust/lancedb/src/database.rs` and `rust/lancedb/src/table.rs`.

Validation argument
- The docs expose both knobs but provide no guidance on how they relate, which is exactly what users are asking about.
- This is a classic ops pitfall: users treat prewarm as a consistency control (or vice versa).


How to validate quickly
1) Confirm docs site lacks an index caching guide and any reference linking `prewarm_index` to session cache sizing.
2) Confirm in code that `read_consistency_interval` only controls refresh behavior and `prewarm_index` only loads index data into memory.

---
