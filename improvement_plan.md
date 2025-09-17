Phase 1 — Reasoning depth and evidence coverage
1) Value-of-Information (VoI) loop
•  Goal: The orchestrator chooses the next best investigative step based on expected payoff toward satisfying the user’s intent.
•  Inputs to VoI scoring:
•  Relevance to intent/dimension (from the Answer Spec)
•  Uncertainty reduction (how much this could reduce ambiguity in the current claims)
•  Novelty (how much non-overlapping information vs. what we already have; penalize near-duplicates)
•  Connectivity/impact (touches many nodes or high-centrality concepts; likely to unlock more)
•  Causal potential (helps explain “why,” not just “what”)
•  Mechanism:
•  Maintain a frontier of candidate expansions (queries, relations X→Y to probe, sections/chapters to sample).
•  Score candidates, pick top-k (beam 2–3 per round) within budget.
•  Log VoI scores and decisions for transparency.

2) Span coverage for single docs and structured docs
•  Why: Avoid tunnel vision in one part of a book or paper. Ensure we sample across the whole.
•  Document structure detection at summarization/embedding time:
•  Heuristics for detecting structure:
◦  DOCX: heading styles, outline levels, bookmarks.
◦  Markdown: #, ##, ### headings; front matter; section anchors.
◦  PDF: outline/TOC when available; otherwise heuristic page windows.
◦  Scientific patterns: detect common section headers (Abstract, Introduction, Methods, Results, Discussion, Conclusion).
◦  Books: split into early/middle/late windows by chunk index; also sniff chapter markers.
•  Build a DocStructureMap:
◦  sections: [{ name, startOffset, endOffset, childSections? }]
◦  map chunk ranges to sections; store section prototypes (key terms).
•  Retrieval policy using structure:
•  When a doc is selected by the reranker, allocate a section quota (e.g., at least one chunk from different major sections or windows).
•  Prefer diverse parents (parent-child chunking) and avoid piling from adjacent child chunks.
•  If a section has many candidate hits, use MMR and clustering to maintain variety.
•  Benefits: Even with a single book/paper, captured views differ across sections, giving broader, more accurate synthesis.

3) Near-duplicate clustering + coverage-aware selection
•  Clustering:
•  Use cosine-similarity threshold or MinHash/SimHash to group near-duplicates across candidate chunks.
•  Keep centroids or the most representative chunk per cluster.
•  Coverage-aware selection:
•  MMR: score = λ*relevance − (1−λ)*redundancy.
•  Hard caps:
◦  Max N chunks from the same parent or section.
◦  At least 1 chunk from M distinct sections/windows when available.
•  Outcome: Fewer redundant snippets; more breadth; faster claim extraction.

4) Investigator-friendly gatherers (expand on current)
•  Extract claims, not just scene snippets:
•  Claim fields: text, type (trait/relationship/arc/theme/event), entities, evidence [{id,start,end,quote?}], confidence, dimension.
•  Allow negative/contradictory evidence and “uncertainty reason” fields.
•  Encourage selective quotes to anchor big claims (1–3 max).
•  Result: Aggregator can generalize to persona-level statements with proper anchoring.

5) Rubric-driven evaluator (strong gate)
•  Rubric dimensions (calibrated to intent):
•  Organization and coverage (induced dimensions are present; section headings reflect intent).
•  Abstraction (persona-level synthesis vs micro-event lists).
•  Evidence quality (anchored; minimal yet telling quotes; consistent citation style).
•  Span coverage (different sections/windows represented when available).
•  Contradictions (noted/reconciled) and Gaps/Open Questions if incomplete.
•  Language/style consistency.
•  Behavior:
•  If rubric fails → generate a gap plan → run VoI to select the best next steps within budgets.
•  If rubric passes → stop early even if budget remains.

Phase 2 — Multi-iteration refinement with budgets (how it works, gains vs costs)
•  What it is:
•  The orchestrator runs multiple reasoning iterations (e.g., 1–3 cycles).
•  Each iteration: VoI → gatherers → aggregator → compose → evaluator → decide to stop or continue.
•  Budgets (hard and soft):
•  Hard caps: max iterations (e.g., 3), max elapsed time (e.g., 120s), max LLM calls (e.g., 16), max tokens (e.g., 80k).
•  Soft caps: per-iteration target (# claims added, # unique sections hit) and early-stop when rubric passes.
•  Gains:
•  Quality increases predictably (fills missing dimensions; resolves contradictions; secures better quotes).
•  Answers align to intent rather than being constrained by a single pass.
•  Costs:
•  More LLM calls → more latency + tokens.
•  Diminishing returns after 2–3 rounds; hence the rubric-based early stop and VoI beam keep it efficient.
•  Design to keep latency manageable:
•  Parallelize LLM tasks (we do) and serialize coordinator tasks (we do).
•  Beam width small (top 2–3 expansions per round).
•  Cache partial products (claims per chunk/window) to reuse across rounds.
•  Strong span and clustering reduce waste.

Phase 3 — Retrieval robustness and hybrid scoring (optional but synergistic)
•  Lexical fallback + hybrid:
•  If embedding results have low confidence/variety, run a quick BM25/keyword fallback over the same index.
•  Merge and rerank; penalize duplicates and uplift novelty/coverage.
•  Alias/coref assist:
•  Maintain lightweight alias lists and pronoun-coref sampling in nearby windows.

Phase 4 — Observability and UX (can be done in parallel if you like)
•  Better logs (and optional UI panel):
•  Stage boundaries and durations (Intent, Expand, Retrieve, Claims, Evaluate, Refine, Compose).
•  VoI table per iteration: candidates and their scores; which ones were chosen and why.
•  Coverage meter for structured docs (sections/windows hit).
•  Budgets dashboard: elapsed time, tokens, LLM calls, iterations.
•  User control toggles:
•  Thoroughness (concise/balanced/comprehensive)
•  Max iterations/time/token budgets
•  Enforce span coverage (on/off)
•  Require quotes (on/off)
•  Concurrency caps (LLM), timeouts (LLM/embed/rerank)

Expected net effects
•  VOI + span coverage + clustering/MMR: Produce broader, higher-quality answers with fewer redundant snippets, even for a single book/paper.
•  Investigator gatherers + rubric: Answers shift from “event lists” to well-organized, claim-backed insights aligned to intent.
•  Multi-iteration budgets: Predictable trade-off—better answers when needed, early stop when sufficient.

Proposed implementation order (iteration-friendly)
•  Step A: DocStructureMap + span coverage in retrieval; near-duplicate clustering + MMR selection.
•  Step B: VOI frontier + scoring and a single extra refinement cycle (beam 2–3) under a simple time/LLM-call budget.
•  Step C: Strengthen gatherers (negative evidence, uncertainty reason) and rubric (hard gate).
•  Step D: Observability (stage logs, coverage meter, VoI decisions) + optional UI panel.
•  Step E: Add a second refinement iteration (if needed) with tight budgets.
•  Step F: Optional hybrid lexical fallback for poor embedding cases.