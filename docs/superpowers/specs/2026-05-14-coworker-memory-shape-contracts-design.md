# Coworker Memory Shape Contracts - Design

| Field | Value |
|-------|-------|
| Backlog epic | `EP-TAK-3F9A21` - TAK/GAID Refresh: Auth, Agent Identity, and Governed Memory Alignment |
| Related live backlog items | `BI-MEM-5A41C7`, `BI-OBS-4B63F2`, `BI-GAID-8D72B4`, `BI-MCP-7E53D1` |
| Status | Revised draft for review |
| Created | 2026-05-14 |
| Revised | 2026-05-14 repo-grounded review |
| Author | Mark Bodman + Claude/Codex design partners |
| IT4IT alignment | Evaluate, Build, Consume |
| Builds on | [EP-TAK-3F9A21 - Auth, Agent Identity, and Governed Memory](2026-04-25-tak-gaid-auth-identity-memory-refresh-design.md), [Platform Kernel Wiki](2026-05-09-platform-kernel-wiki-design.md), [Wiki PPR Retrieval](2026-05-09-wiki-ppr-retrieval-design.md), [Autonomous AI Coworker Runtime](2026-05-11-autonomous-coworker-runtime-design.md) |
| Sharpens | [AI Coworker Development Principles P3, P5, P7](../../architecture/ai-coworker-development-principles.md) |

Live backlog check on 2026-05-14 found an existing open epic for this work: `EP-TAK-3F9A21`. This plan should sharpen that epic and its live items, not create a duplicate `EP-MEM-SHAPE-001` unless the backlog owner explicitly splits it later through the governed MCP workflow.

---

## 0. Review Corrections From This Pass

This revision keeps the original thesis, but corrects the parts that drifted from current repo truth.

| Draft claim | Current repo truth | Plan correction |
|---|---|---|
| The plan needs a new proposed epic. | Live backlog already has `EP-TAK-3F9A21` with governed-memory, observability, GAID, and MCP items. | Attach this plan to the existing epic and map slices to live items first. |
| AI Coworker chat loads `AgentMessage` thread history unbounded. | [`agent-coworker.ts`](../../../apps/web/lib/actions/agent-coworker.ts) already trims prompt history: `/build` gets a larger bounded window, other routes get a smaller one, and older messages are paged separately. | The real gap is not unlimited loading. It is that the windowing policy is implicit, not declared as an input contract, and older turns do not have a durable continuation summary. |
| Scheduled/autonomous runs need a new `RunHandoff` table. | [`agent-task-scheduler.ts`](../../../apps/web/lib/actions/agent-task-scheduler.ts) already creates a `TaskRun`, `TaskMessage`, and links `ScheduledAgentTask.taskRunId`. | Use `TaskRun` plus a typed continuation summary first. Add a table only if `TaskRun` cannot express the boundary. |
| Phase handoff is absent. | [`PhaseHandoff`](../../../packages/db/prisma/schema.prisma) exists and Build Studio reads it in some paths. Some advancement routes write handoffs best-effort or skip them. | Enforce `PhaseHandoff` as a mandatory boundary contract for Build Studio phase transitions rather than inventing a parallel primitive. |
| Wiki PPR and section retrieval are already runtime primitives for specs/plans. | [`spec-plan-search.ts`](../../../apps/web/lib/backlog/spec-plan-search.ts) still uses markdown scanning and substring matching for specs/plans. Wiki vector recall exists, but PPR remains design-direction, not universal runtime truth. | Keep section-aware spec/plan retrieval as a future slice and label it honestly. |
| Semantic memory already carries the right authority metadata. | [`semantic-memory.ts`](../../../apps/web/lib/inference/semantic-memory.ts) writes route, user, agent, thread, preview, fingerprint, and timestamp metadata, but not authority, memory scope, or promotion status. | Add authority/scope payload hardening after the contract and UI slices prove the shape. |

---

## 1. Intent and Non-Goals

DPF already has memory primitives: Qdrant `agent-memory`, Qdrant `wiki-pages`, `UserFact`, `AgentThread`, `AgentMessage`, `TaskRun`, `TaskMessage`, `TaskArtifact`, `PhaseHandoff`, `ToolExecution`, and `ToolExecutionReceipt`. The problem is that coworkers do not yet have a reviewed, visible contract that states which inputs may enter a run, what authority each input carries, how stale or missing data behaves, and what the coworker must emit at the boundary.

This spec adds a contract layer over existing substrate.

It is not:

- a new memory store
- a replacement taxonomy for TAK governed memory
- a parallel run identity model
- a greenfield RAG platform
- a permission bypass for direct backlog or database writes

The architectural move is deliberately refactoring-heavy: make the implicit runtime contract explicit, make it observable, and only then harden storage payloads or add schema where the existing primitives cannot carry the contract.

---

## 2. Research and Benchmarking

Every new feature spec needs explicit benchmarking. The useful pattern across current agent-memory systems is not "store more"; it is "separate short-term state, durable memory, structured artifacts, and graph-shaped context so the model is not asked to rediscover its own operating context."

| Reference | Pattern to adopt | Pattern to reject for DPF |
|---|---|---|
| [LangGraph memory](https://docs.langchain.com/oss/python/langgraph/memory) and [persistence](https://docs.langchain.com/oss/python/langgraph/persistence) | Treat thread state and persistent memory as different concepts. Persist checkpoints at explicit execution boundaries. | Do not migrate DPF orchestration to LangGraph just to get the terminology. DPF already has `TaskRun`, `PhaseHandoff`, and `ToolExecution`. |
| [Letta memory blocks](https://docs.letta.com/guides/core-concepts/memory/memory-blocks) | Use small named context blocks with clear read/write rules. DPF can mirror this through declared input fields and read-only authoritative blocks. | Do not allow coworkers to self-edit core identity or governance memory. TAK must stay authoritative. |
| [LlamaIndex hierarchical parsing](https://docs.llamaindex.ai/en/stable/api_reference/node_parsers/hierarchical/) | Long structured documents should keep section hierarchy during retrieval. Specs and plans should not be flattened into substring snippets. | Do not treat every markdown document as undifferentiated prose. |
| [Microsoft GraphRAG](https://www.microsoft.com/en-us/research/project/graphrag/) and [GraphRAG docs](https://microsoft.github.io/graphrag/index/overview/) | Relationship-heavy questions benefit from graph-shaped retrieval when the graph exists and is scoped. | Do not put all memory in Neo4j. Use graph retrieval for adjacency questions only. |
| [Mem0/OpenMemory](https://docs.mem0.ai/openmemory/overview) | Production memory systems expose persistent memory as a managed layer with user, agent, and metadata scope. | Do not add an external memory layer when DPF already owns the governance, audit, and local runtime requirements. |

The benchmarked direction is a hybrid: declare the shape first, route retrieval to the primitive that matches that shape, and expose the delivered context to operators.

---

## 3. Verified Current Repo Truth

| Area | Verified fact | Source |
|---|---|---|
| AI Coworker prompt assembly | The send path builds route-aware prompt context from recent messages, governed memory, page context, tool grants, wiki recall, and optional Build Studio handoff context. | [`agent-coworker.ts`](../../../apps/web/lib/actions/agent-coworker.ts) |
| Chat windowing | Current prompt history is bounded and token-trimmed, but the policy is embedded in code instead of being declared as a reusable coworker contract. | [`agent-coworker.ts`](../../../apps/web/lib/actions/agent-coworker.ts) |
| Governed memory | `buildGovernedMemoryContext` resolves AIDoc, action risk, user facts, semantic recall, counts, and operating profile fingerprint. | [`governed-memory.ts`](../../../apps/web/lib/tak/governed-memory.ts) |
| User facts | `UserFact` supports categories, confidence, source metadata, active/superseded status, and freshness states. It does not yet provide a universal injected-fact authority surface across all memory classes. | [`user-facts.ts`](../../../apps/web/lib/tak/user-facts.ts), [`schema.prisma`](../../../packages/db/prisma/schema.prisma) |
| Semantic memory | `agent-memory` points include user, agent, route, route domain, thread, role, preview, fingerprint, and timestamp payload fields. They do not include authority, memory scope, or promotion state. | [`semantic-memory.ts`](../../../apps/web/lib/inference/semantic-memory.ts), [`qdrant.ts`](../../../packages/db/src/qdrant.ts) |
| Wiki recall | Wiki page recall is vector-backed and overlay-aware, with organization and kernel fallback. It is not the same thing as spec/plan retrieval. | [`wiki/recall.ts`](../../../apps/web/lib/wiki/recall.ts), [`wiki/embeddings.ts`](../../../apps/web/lib/wiki/embeddings.ts) |
| Spec/plan search | Backlog-facing spec search still scans markdown files and ranks substring matches. | [`spec-plan-search.ts`](../../../apps/web/lib/backlog/spec-plan-search.ts) |
| Build handoffs | `PhaseHandoff` exists, `save_phase_handoff` exists, and some build paths read or write handoffs. Some transitions still advance without making the handoff the mandatory input/output boundary. | [`mcp-tools.ts`](../../../apps/web/lib/mcp-tools.ts), [`build.ts`](../../../apps/web/lib/actions/build.ts), [`advance-phase/route.ts`](../../../apps/web/app/api/agent/build/advance-phase/route.ts) |
| Receipts | `ToolExecution.taskRunId` and `ToolExecutionReceipt` exist, and some sandbox/UX tools write receipts with input fingerprints. | [`schema.prisma`](../../../packages/db/prisma/schema.prisma), [`mcp-governed-execute.ts`](../../../apps/web/lib/mcp-governed-execute.ts), [`build-artifact-provenance.ts`](../../../apps/web/lib/build/build-artifact-provenance.ts) |
| Scheduled tasks | Scheduled coworkers create `TaskRun` and `TaskMessage` rows and link the scheduled task to `taskRunId`. The missing piece is a deterministic continuation summary for the next run. | [`agent-task-scheduler.ts`](../../../apps/web/lib/actions/agent-task-scheduler.ts) |
| Neo4j | Neo4j is documented as projection/read-side infrastructure, not authoritative storage. Current coworker memory loaders do not consume it for build/backlog adjacency. | [`neo4j.ts`](../../../packages/db/src/neo4j.ts), [platform overview](../../architecture/platform-overview.md) |

---

## 4. Problem Statement

DPF can remember and retrieve, but coworkers do not yet have an explicit memory shape contract.

The practical consequence is that the same system can be technically capable and still behave inconsistently:

- A coworker can receive route context, facts, wiki snippets, and semantic recall without a visible bundle saying what was delivered.
- A user can wonder why the coworker re-asked a question without seeing whether the fact was missing, stale, withheld, or never looked up.
- A downstream Build Studio phase can read a conversation tail even though the architectural contract wants a structured handoff.
- A scheduled coworker can have a `TaskRun` but still lack a compact, deterministic next-run state.
- A spec search can return a substring hit from a long design doc even when the right unit of recall is a section.

The design goal is not more memory. It is a reviewed contract for memory entering and leaving a run.

---

## 5. Principles to Add

These principles should be added as kernel wiki pages only after this spec is accepted. They sharpen existing coworker principles rather than replace them.

### P9 - Bundle Declaration Before Run

Every coworker run declares its input bundle before execution: fields, source primitive, shape, authority, freshness expectation, required/optional status, token budget, and degradation behavior. The coworker reads the declared bundle, not an accidental prompt blob.

Sharpens P3, Structured Handoffs. P3 covers the output boundary. P9 covers the input boundary.

### P10 - Retrieval Shape Matches the Work

The retrieval primitive must match the shape of the work:

- prose context uses semantic recall
- long structured documents use section-aware document retrieval
- governed facts use typed Postgres views or `UserFact`
- relationship questions use graph-shaped retrieval
- workspace state uses filesystem/diff primitives
- proof of work uses receipts and audit evidence

Sharpens P5, Selective Memory. The hard part is not selecting fewer tokens; it is selecting the right primitive.

### P11 - Provenance and Quarantine on Every Injected Fact

Every fact injected into a coworker prompt carries source, authority, freshness, and scope. Inferred memory stays inferred until a user confirmation, tool receipt, verified outcome, or authoritative record promotes it. Coworkers prefer authoritative and user-confirmed facts because metadata says so, not because a prompt happens to phrase them more strongly.

Sharpens TAK freshness and self-edit boundaries. The principle applies to all memory classes, not only `UserFact`.

---

## 6. Contract Shape

The first implementation should be TypeScript-first and co-located with coworker registration. That keeps the initial slice reviewable and avoids creating another admin-editable domain before the shape has proven itself.

```typescript
export type CoworkerContextShape =
  | "prose"
  | "structured-doc"
  | "tabular"
  | "relational"
  | "filesystem"
  | "text-diff"
  | "receipt";

export type MemoryAuthority =
  | "authoritative"
  | "user-confirmed"
  | "inferred"
  | "advisory";

export type FreshnessPolicy =
  | "any"
  | "current-only"
  | "revalidate-before-consequential-action";

export type ContractDegradation =
  | "block-run"
  | "omit-field"
  | "compress"
  | "fallback-to-primary-source";

export type CoworkerInputFieldContract = {
  name: string;
  shape: CoworkerContextShape;
  primitive: string;
  authority: MemoryAuthority;
  required: boolean;
  freshness: FreshnessPolicy;
  degradation: ContractDegradation;
  tokenBudget?: number;
  sourceRef: string;
  promptLabel?: string;
};

export type CoworkerInputContract = {
  coworkerId: string;
  routeScope?: readonly string[];
  fields: readonly CoworkerInputFieldContract[];
  output: {
    writes: readonly string[];
    receipts?: readonly string[];
    handoff?: "PhaseHandoff" | "TaskMessage" | "TaskArtifact" | "none";
  };
};
```

The loader should produce a run-local delivery report:

```typescript
export type CoworkerContractDelivery = {
  delivered: string[];
  compressed: string[];
  withheld: Array<{ field: string; reason: string }>;
  missingRequired: string[];
  tokenEstimate: number;
};
```

Missing required fields either block the run or fall back to an authoritative primary source, depending on the declared degradation behavior. They should never silently disappear.

---

## 7. Retrieval Shape Routing

| Shape | When to use | Current primitive | Contract behavior |
|---|---|---|---|
| `prose` | Conversation snippets, rationale, episodic recall | Qdrant `agent-memory` via semantic recall | Route-scoped first, then global fallback. Always label inferred/user-confirmed authority. |
| `structured-doc` | Specs, plans, wiki pages, policies | Wiki recall today; future section-aware spec/plan retriever | Preserve heading/section source. Snippets must link back to document and section. |
| `tabular` | User facts, backlog items, feature builds, tool grants | Prisma/Postgres typed records | Treat database row as primary source. Do not summarize away key IDs or status values. |
| `relational` | "Which X connects to Y?" | Wiki PPR design for wiki; Neo4j projection for build/backlog adjacency later | Use only for adjacency questions. Do not make graph storage authoritative. |
| `filesystem` | Workspace state, generated files, artifacts | Sandbox filesystem and git working tree | Include path, branch/worktree, and dirty-state summary. |
| `text-diff` | Code review, Build Studio review, PR repair | Git diff plus target spec/plan | Keep file paths and changed hunks separate from prose conclusions. |
| `receipt` | Proof that a tool or verification step already ran | `ToolExecution` and `ToolExecutionReceipt` | Use input fingerprint for idempotency and provenance. |

---

## 8. Per-Coworker Contracts and Fixes

### 8.1 AI Coworker Chat

Current state: the runtime already uses bounded recent message windows, governed memory context, wiki recall, tool grants, route/page data, and optional Build Studio handoff context. The issue is that this bundle is implicit, distributed across code branches, and invisible to the operator.

Initial contract fields:

| Field | Shape | Primitive | Authority | Behavior |
|---|---|---|---|---|
| `principal_identity` | `tabular` | Principal/User/AIDoc resolution | `authoritative` | Block consequential actions if missing. |
| `route_context` | `tabular` | route registry and page context | `authoritative` | Omit optional page details when stale. |
| `recent_thread_window` | `prose` | `AgentMessage` bounded window | `inferred` | Compress if token budget is exceeded. |
| `thread_summary` | `prose` | new rolling summary artifact or semantic point | `inferred` | Use for older turns; link to raw messages for audit. |
| `governed_user_facts` | `tabular` | `UserFact` | `authoritative` or `user-confirmed` | Revalidate before consequential action. |
| `semantic_recall` | `prose` | Qdrant `agent-memory` | `inferred` or `user-confirmed` | Withhold stale same-profile-sensitive recall when policy requires. |
| `wiki_context` | `structured-doc` | `recallWikiContext` | `authoritative` or `advisory` | Include source page and section. |
| `tool_grants` | `tabular` | grant resolver | `authoritative` | Block tool claims when grant is absent. |

Highest-value fix: add the contract declaration and delivery report first, then add a rolling thread summary so older conversation state has a deterministic, compact shape instead of being rediscovered or re-summarized ad hoc.

### 8.2 Build Studio Phases

Current state: Build Studio has `PhaseHandoff`, phase gates, sandbox receipts, and Build Studio-specific context injection, but the phase boundary is not consistently mandatory across all advancement paths.

Initial contract fields:

| Phase | Required inputs | Required outputs |
|---|---|---|
| Ideate/Scout | backlog item, route/build context, adjacent specs, prior similar builds if available | `FeatureBuild.scoutFindings`, `PhaseHandoff(ideate -> plan)` |
| Plan | prior `PhaseHandoff`, target spec sections, affected module context, architecture invariants | spec/plan artifact, `PhaseHandoff(plan -> build)` |
| Build | plan handoff, workspace state, allowed tools, prior receipts for identical fingerprints | file changes, tool receipts, `PhaseHandoff(build -> review)` |
| Review | build handoff, target spec sections, diff, verification evidence | severity-tagged findings, `PhaseHandoff(review -> ship)` |
| Ship | review handoff, DCO/credential state, PR template, contribution mode | PR/contribution record, evidence receipt |

Highest-value fix: make `PhaseHandoff` creation and consumption transactional with phase advancement. A phase transition should either produce the required handoff or fail visibly. Do not add a new handoff table for Build Studio.

### 8.3 Scheduled and Autonomous Coworkers

Current state: scheduled tasks now create a `TaskRun`, write `TaskMessage` rows, invoke the agentic loop with `taskRunId`, and link the scheduled task to the latest run.

Initial contract fields:

| Field | Shape | Primitive | Authority | Behavior |
|---|---|---|---|---|
| `schedule_definition` | `tabular` | `ScheduledAgentTask` | `authoritative` | Block run if inactive or malformed. |
| `prior_run_summary` | `structured-doc` | `TaskArtifact` or typed `TaskMessage` metadata | `authoritative` | Use for continuation instead of replaying the thread. |
| `delta_since_last_run` | `tabular` | typed Postgres query bounded by `lastRunAt` | `authoritative` | Recompute from primary records, not prior prose. |
| `tool_grants` | `tabular` | grant resolver | `authoritative` | Block tool claims when grant is absent. |

Highest-value fix: write a deterministic `run-continuation-summary` at the end of each scheduled run. Prefer `TaskArtifact` if downstream runs need deterministic lookup; use typed `TaskMessage` metadata only if the summary is primarily part of the conversation projection.

### 8.4 Hive Scout and Backlog Contribution Flows

Current state: the platform already has the right concept of governed backlog interaction and submitter attribution. The memory contract here should prevent duplicate ingestion and preserve provenance.

Initial contract fields:

| Field | Shape | Primitive | Authority | Behavior |
|---|---|---|---|---|
| `upstream_catalog_snapshot` | `structured-doc` | fetched catalog plus ETag/hash | `authoritative` | Skip if unchanged. |
| `existing_backlog_dedup_set` | `tabular` | live backlog query through MCP/Postgres | `authoritative` | Block direct write if live query fails. |
| `submitter_identity` | `tabular` | coworker identity/GAID/AIDoc | `authoritative` | Required for any backlog suggestion. |
| `prior_receipt` | `receipt` | `ToolExecutionReceipt.inputFingerprint` | `authoritative` | Short-circuit repeated ingestion. |

Highest-value fix: use input fingerprints and submitter attribution for idempotent backlog suggestions. Keep backlog mutation behind MCP tools when available.

---

## 9. Operator UI - Memory Contract Inspector

This design needs a visible operator surface, not just runtime types. Add a read-only first version at `/platform/ai/memory-contracts` or as a first-class tab under the existing AI operations area.

V1 layout:

| Region | Content |
|---|---|
| Left rail | Coworker and route list with contract health: ok, missing optional, missing required, stale, withheld. |
| Main table | Field, shape, primitive, authority, freshness, delivered/missing/withheld, token budget, last delivered time. |
| Inspector drawer | Source refs, recent delivered examples, withheld reasons, evidence receipts, and prompt-preview excerpt. |
| Metrics strip | `contract_delivery_rate`, `missing_required_fields`, `stale_or_withheld_fact_count`, `tokens_before_first_useful_tool_call`, `re_asked_questions_count`. |
| Deep links | `/platform/ai/history`, `/platform/ai/authority`, relevant `TaskRun`, relevant `ToolExecutionReceipt`, source spec/wiki page. |

UI design rules:

- Use DPF theme tokens only: `text-[var(--dpf-text)]`, `text-[var(--dpf-muted)]`, `bg-[var(--dpf-surface-1)]`, `bg-[var(--dpf-surface-2)]`, `border-[var(--dpf-border)]`, and `text-[var(--dpf-accent)]`.
- Keep the surface dense and operational. This is an operator table, not a landing page.
- Avoid cards inside cards. Use a full-width page band with a constrained table and a drawer.
- Use compact badges for shape, authority, and freshness, but make each badge token-backed rather than hardcoded color-backed.
- Every alert state must offer the nearest evidence link, not just a warning label.
- The first screen should answer: "What context entered this coworker run, what was withheld, and why?"

---

## 10. Phasing

| Slice | Scope | Backlog alignment | Schema impact |
|---|---|---|---|
| 1 | Contract substrate plus AI Coworker chat declaration and delivery report | `BI-MEM-5A41C7` | None expected |
| 2 | Read-only Memory Contract Inspector with delivery telemetry | `BI-OBS-4B63F2` | None expected if telemetry uses existing run/log records |
| 3 | Semantic memory payload hardening: authority, memory scope, freshness/source IDs, and Qdrant indexes | `BI-MEM-5A41C7` | Qdrant payload/index update; avoid SQL migration unless `UserFact` UI needs filtering |
| 4 | Build Studio `PhaseHandoff` enforcement across all phase advancement paths | Also aligns to active Build Studio cycle items | Possible no-schema refactor if current `PhaseHandoff` is sufficient |
| 5 | Section-aware spec/plan retriever replacing substring-only matching for docs/superpowers | `BI-MEM-5A41C7` or a new MCP-created item | None expected |
| 6 | Scheduled coworker continuation summary using `TaskRun` plus `TaskArtifact` or typed `TaskMessage` metadata | `BI-MEM-5A41C7` | Prefer no new table |
| 7 | Neo4j build/backlog adjacency projection for Scout/Plan/Review relational questions | New MCP-created item after graph scope is accepted | Projection only; Postgres remains authoritative |
| 8 | Rediscovery-rate automation that can propose `CoworkerCapabilityNeed` or backlog suggestions with submitter attribution | `BI-MCP-7E53D1`, `BI-GAID-8D72B4` | Depends on accepted contribution workflow |

Ordering rationale: slices 1 and 2 make the hidden contract visible before schema hardening. That gives the team evidence about which fields are actually missing, stale, over-budget, or redundant before committing to migrations.

---

## 11. Acceptance and Verification

Doc-only acceptance for this plan:

- The document must separate current repo truth from proposed future contracts.
- All current-state claims must point at live repo primitives rather than seed data or stale design assumptions.
- Backlog linkage must use live backlog state or explicitly say when MCP/DB fallback was unavailable.

Implementation acceptance for future slices:

- Unit tests for affected contract loaders, memory recall, scheduled continuation, and spec retrieval. Use pinned workspace tooling, for example:

```powershell
pnpm --filter web exec vitest run apps/web/lib/tak/governed-memory.test.ts apps/web/lib/inference/semantic-memory.test.ts
pnpm --filter web exec vitest run apps/web/lib/actions/agent-coworker.test.ts apps/web/lib/actions/agent-task-scheduler.test.ts
pnpm --filter web exec vitest run apps/web/lib/backlog/spec-plan-search.test.ts
```

- Typecheck:

```powershell
pnpm --filter web typecheck
```

- Production build:

```powershell
cd apps/web
pnpm exec next build
```

- UI/UX verification for any inspector or coworker UI change against the Docker-served app URL from `.env`, logging in as `admin@dpf.local` with repo-root `ADMIN_PASSWORD`.
- For Qdrant payload/index changes, run a dry-run inventory first: count existing points, sample payloads, and verify the backfill labels old memory as inferred/advisory rather than silently promoting it.
- For Build Studio handoff enforcement, exercise at least one phase transition through the UI and one direct advance route, then confirm the handoff and phase update are committed together.

---

## 12. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Contract declarations become ceremony. | The loader emits a delivery report and blocks only when required fields are missing. Operators see whether the contract is doing work. |
| Authority labels collapse into everything being authoritative. | Default semantic memory to inferred/advisory. Promotion requires a user confirmation, authoritative source, or receipt. |
| The Memory Contract Inspector becomes another abstract AI page. | Make it run-first and evidence-first: field delivery, withheld reasons, source links, and prompt-preview excerpts. |
| Build Studio handoff enforcement breaks existing flows. | Start by instrumenting missing handoffs, then flip gates per phase once the UI and direct route both write handoffs reliably. |
| Section-aware retrieval duplicates wiki code. | Reuse the same section parser and metadata conventions where possible; do not fork a second retrieval framework. |
| Neo4j becomes an attractive nuisance. | Keep it projection-only and limited to adjacency questions. Postgres remains the write authority. |
| Scheduled continuation summaries lose detail. | Raw `TaskMessage` and `AgentMessage` records remain the audit trail; the summary is a deterministic run input, not a deletion. |

---

## 13. Open Questions

1. Should contracts remain TypeScript-only after V1, or should accepted contracts be seeded into `PromptTemplate`/DB-backed configuration? Recommendation: TypeScript first, DB only after the shape stabilizes.
2. Is `TaskArtifact` or typed `TaskMessage` metadata the better continuation-summary carrier? Recommendation: `TaskArtifact` if downstream runs need deterministic lookup; `TaskMessage` metadata if the summary is primarily conversation-facing.
3. Should authority class become a `UserFact` schema field now or start as Qdrant/result metadata? Recommendation: start with recall-result metadata and Qdrant payload hardening, then add SQL only when the UI needs filtering or reporting.
4. Should the inspector live at `/platform/ai/memory-contracts` or inside the AI Operations Map? Recommendation: make it a route/tab for discoverability, then deep-link from Operations Map nodes.
5. Should Build Studio handoff enforcement be part of this TAK/GAID epic or the active Build Studio cycle epic? Recommendation: keep the contract design here and implement the Build Studio phase-gate slice under the active Build Studio workstream to avoid mixing concerns in one PR.

---

## 14. Out of Scope

- Replacing the five-class governed memory model.
- Introducing a new memory database or external memory service.
- Issuing public GAIDs or changing the GAID trust boundary.
- Building a personal wiki/openbrain control plane.
- Direct database edits for backlog creation or status changes.
- Making Neo4j authoritative for any domain record.
