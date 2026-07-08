# AI Coworker Memory & Context Architecture — program plan

- **Epic:** EP-8C706944 — *AI Coworker Memory & Context Architecture — lifecycle completion, projections, effort-scoped sharing*
- **Kernel ledger:** DI-F69AE978B70C (`principle_decide`, 4 options scored, recommends **hybrid-lifecycle-plus-projections**, confidence **high**, composite 9.583, margin 0.266)
- **Date:** 2026-07-08 (founder-directed goal, this session)
- **Status:** Plan ratified; implementation phased across 9 triaged-build BIs (below)
- **Composes with:** EP-CLAUDE-INSIDE-OUT (BI-F9025BA0 per-coworker working memory — slice 2 prompt injection stays there), EP-CTX-001 context arbitrator, EP-F7E35344 / BI-45514C4E (unified coworker path), `docs/architecture/context-engineering-standards.md`

## 1. Problem (founder framing, corrected by substrate audit)

The founder's framing: coworker chats are endless text streams with no memory construct, no short/long-term capture/pruning/optimization, token spend bounded only by provider limits, no cross-coworker multi-session working context, and no answer for how memory separates/shares across ~10 human employees.

The substrate audit (three parallel explorers, verified against origin/main after a stale-checkout correction) shows the *capture* half largely exists; the **lifecycle, scoping, and effort halves do not**:

**Exists today (do not rebuild):**
- **Structured user memory** — `UserFact` (preference|decision|constraint|domain_context), LLM-extracted fire-and-forget per turn, supersession chain, injected as an L1 arbitrator block (`lib/tak/governed-memory.ts`).
- **Per-coworker working memory** — `CoworkerMemoryNote` + self-scoped `record_working_note`/`list_working_notes` door (BI-F9025BA0 slice 1, merged #2702); prompt injection = slice 2, pending in EP-CLAUDE-INSIDE-OUT.
- **Semantic episodic recall** — Qdrant `agent-memory` (768-dim, every substantive message embedded), governed two-pass recall hard-filtered to `userId`.
- **Corporate memory** — WWMD/WWWD/WSID `WikiPage` corpus (vector + PPR retrieval, perspective routing), `BusinessContext`, `Document`/`KnowledgeArticle`, `DecisionInteraction` ledger, governed learning-routing pipeline (`dpf-route-learning-to-commons` → commons/hive).
- **Context management** — EP-CTX-001 budget arbitrator (L0–L2), rolling thread compaction (threshold 20, batch 10), extractive compaction digest, per-model tool-result clamps, context-pressure gauge, `CoworkerTurnMetric` per-turn telemetry.
- **Projection substrate** — code graph, EA graph (`EAElement`/`EARelationship`), Prisma→EA data-model mirror, `ToolExecution` audit ledger (cross-user, indexed by agentId).

**Genuinely missing (the program):**
1. **No persisted summaries** — thread compaction rewrites history only in the in-flight array; the same spans are re-summarized with a fresh LLM call on *every* subsequent turn (recurring token spend), and nothing survives as a durable checkpoint.
2. **No pruning/TTL/consolidation anywhere** — `AgentMessage`, Qdrant vectors, `UserFact`, `CoworkerMemoryNote` grow unbounded; supersede-only, never expire; no dedup/contradiction gate at write time. The designed autonomous consolidation pass ("autoDream", spec `2026-04-02-agentic-architecture-patterns-design.md`) never shipped.
3. **No per-thread token/cost ledger** — per-turn metrics only; no cumulative rollup, no spend-awareness in compaction/recall decisions.
4. **Memory siloed per human user** — `AgentThread` unique `[userId, contextKey]`; `UserFact`, semantic recall, proactivity prefs all hard-filter `userId`. A coworker serving 10 employees keeps 10 disjoint memories; no org-shared working memory and no policy layer deciding what should share vs stay private.
5. **No effort-scoped shared context** — multi-coworker multi-session work outside Build Studio is stitched only by FKs (`backlogItemId`/`epicId`); `WorkCapsule` is single-executor/single-lease; `PhaseHandoff` is a rich cross-phase memory schema **with zero read/write wiring** (documented dead substrate); `ToolExecution` is the best cross-user episodic signal but is unsummarized and never fed back into prompts.
6. **No memory transparency surface** — no human can see or delete what a coworker remembers.

## 2. Research & Benchmarking (AGENTS.md §10)

Full research digest gathered 2026-07-08 (web agent, primary docs + arXiv). Products examined: Claude Code / Anthropic API, ChatGPT/Codex, GitHub Copilot Memory, Cursor, Grok, Linear; frameworks/papers: MemGPT/Letta (incl. sleep-time compute, MemFS), mem0, Zep/Graphiti, LangMem, A-MEM, generative agents, 2025-26 consolidation/forgetting literature (TiMem, SCM, FiFA/MaRS, TOKI).

**Patterns adopted (with source):**
- **Compaction with durable-notes escape hatch, persisted checkpoints, re-injection after squeeze** — Claude Code `/compact` + CLAUDE.md re-read; Anthropic `compact_20260112` + memory-tool pairing (84% token savings benchmark). → Phase 1.
- **Write-time consolidation gate (ADD/UPDATE/SUPERSEDE/NOOP vs top-k neighbors)** — mem0's controller; ChatGPT bio-tool; SAGE novelty gate. → Phase 2.
- **Usage-based expiry with use-resets; supersede-don't-delete with temporal validity** — GitHub Copilot Memory's 28-day LRU auto-delete (production-proven); Zep/Graphiti `valid_at`/`invalid_at`. → Phase 2.
- **Cited memory + read-time validation** — Copilot stores code citations per memory and re-verifies against the current branch before applying, self-healing staleness. DPF analog: provenance fields already exist (`sourceRef`, `sourceMessageId`); validation checks the live record (matches existing fabrication-guard posture). → Phases 2–3.
- **Sleep-time consolidation** — Letta sleep-time compute / dream subagents; generative-agents reflection; Claude Code `consolidate-memory` skill. DPF has the exact runner shape already (nightly Inngest self-task/golden-journey sweeps). → Phase 2.
- **Projections over transcript RAG** — ChatGPT's reference-chat-history is *not* retrieval over transcripts; it is six precomputed profile sections refreshed offline. Zep's context block. Cache-friendly, auditable, layman-explainable. → Phase 3.
- **Artifact-as-memory** — Linear's issue-as-unit-of-context (`promptContext` bundle rehydrates every agent session from the work record + activity log). DPF analog: the effort record briefs each session; `ToolExecution` is the episodic trail. → Phase 3.
- **Two-scope memory with enterprise ownership** — Copilot's repo-shared facts vs private user preferences (org-owned on business plans); Letta shared blocks; Zep user vs group graphs. → Phase 4.
- **Memory manager UI with per-item delete** — ChatGPT/Grok/Copilot all ship one. → Phase 4.
- **Cache-aware layout** — stable memory early under cache breakpoints, volatile late, clear big-and-rarely (`clear_at_least` economics). → Phase 1 constraint on all later phases.

**Patterns rejected:**
- **Invisible auto-memory without audit** — Cursor shipped implicit Memories, then removed them (v2.1) in favor of approval-gated promotion into human-legible rules/skills. Trust collapse risk is highest for non-technical employees.
- **Embedding store as primary memory substrate** — opaque, poor contradiction handling, ungovernable. Qdrant stays an acceleration index; governed rows/records stay the source of truth (`selective-memory-not-total-recall`).
- **A new unified memory subsystem / external framework migration** — scored lowest-viable in the kernel ledger (schema_grounding 0.3, blast_radius 0.85, speed_to_value 0.2); violates `verify-substrate-before-proposing-new`.
- **Per-user private silos as the default for business facts** — a durable business fact learned in one employee's thread belongs to the commons (`learnings-belong-in-the-shared-commons`); ChatGPT's purely-personal default is wrong for coworkers.
- **Memory as enforcement** — every vendor is explicit: memory/instructions are context, not policy. Authority stays in the grants/hooks permission plane; never in memory text.
- **Frequent small context edits** — cache-invalidation economics punish them.

**Anti-patterns identified:** unbounded append-only memory (context rot at write scale); memory-injection as an attack surface (ER-MIA) — scope-classification and sensitivity handling are security features, not polish.

**Gap this design fills vs the field:** nobody has a good production answer for *governed multi-human shared-agent memory* ("employee tells a shared coworker something semi-confidential"). DPF's existing governed-commons pipeline + write-time scope classification (Phase 4) is a differentiated, doctrine-backed answer.

## 3. Decision record

`principle_decide` (callingPopulation `external_coding_agent`, full-kernel scope) scored four architecturally-distinct options: **(a)** lifecycle-completion-on-existing-substrate (9.317), **(b)** new-unified-memory-subsystem, **(c)** projection-first-artifact-as-memory, **(d)** hybrid-lifecycle-plus-projections (**9.583, recommended, high confidence**). Ledger **DI-F69AE978B70C**. The hybrid = (a) plus (c)'s projections, with exactly ONE new substrate concept permitted (effort-scoped shared context) and only after a `PhaseHandoff`/`WorkCapsule` reuse evaluation.

Governing doctrine: `selective-memory-not-total-recall`, `shape-knowledge-for-retrieval`, `findability-is-part-of-capture`, `learnings-belong-in-the-shared-commons`, `verify-substrate-before-proposing-new`, `decisions-belong-to-their-scope`.

## 4. Phased plan (9 BIs, all triaged `build` under EP-8C706944)

### Phase 1 — Stop the bleeding: endless threads get checkpoints + a meter
| BI | Item | Size |
|---|---|---|
| BI-FDECBE0A | Persist thread compaction summaries + post-compaction re-injection (durable checkpoint row + compaction watermark; never re-summarize covered spans; re-inject standing blocks after squeeze; cache-aware layout) | m |
| BI-CCF1ACBB | Per-thread cumulative token/cost ledger (rollup from `CoworkerTurnMetric` + `ToolExecution`; readable by admins and by the runtime so later phases are spend-aware) | s |

### Phase 2 — Lifecycle: consolidate, expire, dream
| BI | Item | Size |
|---|---|---|
| BI-840FDD43 | Write-time consolidation gate (ADD/UPDATE/SUPERSEDE/NOOP vs top-k neighbors) for `UserFact` + `CoworkerMemoryNote`, provenance preserved | m |
| BI-153F7E4A | Usage-based expiry + retention pruning (lastAccessedAt/useCount on recall; 28-day-LRU-style decay; supersede-don't-delete; `AgentMessage`/vector retention once summaries are durable) | m |
| BI-907C4327 | Sleep-time consolidation pass ("autoDream") — nightly Inngest per-coworker reflection: batch-merge/dedupe, contradiction resolution, promote confirmed durables to commons via `dpf-route-learning-to-commons`, prune per policy | l |

### Phase 3 — Projections + effort memory
| BI | Item | Size |
|---|---|---|
| BI-A9052DCB | Session-start projection briefings — precomputed per-(coworker×user) and per-org blocks distilled offline from governed records, refreshed by the sleep-time pass, injected via the EP-CTX-001 arbitrator | l |
| BI-23A65B81 | Effort-scoped shared working context for multi-coworker multi-session work outside Build Studio — **substrate-verify first**: evaluate reusing dead `PhaseHandoff` schema or extending `WorkCapsule` before any new table; Linear-style rehydration; `ToolExecution` summarized as the episodic source | l |

### Phase 4 — Scoping + trust (the 10-human question)
| BI | Item | Size |
|---|---|---|
| BI-1772D0B7 | Two-scope memory: org-shared vs per-user, write-time scope+sensitivity classification, org scope routed through the governed commons pipeline; authority never stored in memory text | l |
| BI-DC8B03AB | Memory transparency + audit UI — per-user "what does my coworker remember" view with per-item delete/correct; admin view of org memory + coworker notes; provenance shown per item (UX-fit gate applies) | m |

**Sequencing rationale:** Phase 1 fixes the live recurring-token-spend defect and gives every later phase a spend signal. Phase 2's gate must precede the sleep-time pass (the pass reuses it in batch mode). Phase 3 projections consume Phase 2's consolidated stores. Phase 4's scoping decisions need Phases 2–3's classification and provenance machinery. BI-F9025BA0 slice 2 (note injection) proceeds independently in EP-CLAUDE-INSIDE-OUT and should land before/alongside Phase 3.

**Cross-surface note:** these mechanics land in the *platform* (in-portal coworkers). External CLI surfaces (Claude Code/Codex/Grok) already carry their own memory planes; parity items remain in EP-CLAUDE-INSIDE-OUT. All work lands via PR per §4 with capsules claimed per §17.

## 5. Explicit non-goals
- No new unified memory service, no external memory framework adoption (kernel-rejected).
- No vector store as source of truth; Qdrant remains an acceleration index.
- No cross-install memory (hive/commons pipeline already owns that lane).
- No coworker-to-coworker private channels — collaboration stays conversation-tree + effort-context bound.
- No enforcement semantics in memory content (permission plane owns authority).

## 6. Verification
- Each BI carries its own build-gate evidence (unit + prod build + UX where applicable) per AGENTS.md §5, executed via Build Studio or external-build capsules.
- Program-level proof: (1) a >40-turn thread shows compaction summaries persisted once, not recomputed (token ledger delta proves it); (2) a fact contradicted in conversation supersedes with provenance and the stale version stops injecting; (3) an unused memory expires on schedule and its expiry is visible in the audit UI; (4) two coworkers + two sessions on one effort rehydrate the same effort context; (5) an org-relevant fact learned in employee A's thread reaches employee B's session via the org scope, while a private preference does not.
