---
status: draft
---

# Unified Build Studio Tracking Across All Surfaces — Gap Analysis & Design

> **⇢ Coordination — Unified Work Graph.** This spec is a design input to the **Collaborative Work Management × Build Studio convergence**. Before starting work traced here, read the governing memo [`2026-07-11-collaborative-work-management-convergence-memo.md`](./2026-07-11-collaborative-work-management-convergence-memo.md) and backlog epic **EP-WORK-CONVERGENCE** (9 items, write-model-first). The target is one substrate — `WorkCapsule` / `WorkItem` → `WorkCase` projection → plain approve/revise — so efforts stay coordinated and don't diverge.

> **2026-09-03 canonical continuation.** The live Workroom-era implementation and
> current backlog supersede this document's historical `WorkCapsule` wording and
> missing BI identifiers. The operator delivery rail, worker/session rollup, and
> Build Studio campaign use are now specified in
> [`2026-09-03-local-first-agentic-delivery-throughput-design.md`](2026-09-03-local-first-agentic-delivery-throughput-design.md).
> This document remains the substrate audit and rationale for one cross-surface
> work identity.


- **Date:** 2026-06-19
- **Status:** draft (research-first; planning + gap analysis)
- **Author:** Claude Code (operator `/goal` session)
- **Proposed epic:** EP-UNIFIED-TRACKING
- **Related epics:** EP-CAPSULE (Work Capsule harness — extends), EP-ROUTING-11 (CLI/execution adapters), EP-AGENTS-DOC, EP-FULL-OBS
- **Related specs:** [`2026-06-05-unified-delivery-surfaces-execution-alignment-design.md`](2026-06-05-unified-delivery-surfaces-execution-alignment-design.md), [`2026-05-14-portal-work-capsule-control-harness-design.md`](2026-05-14-portal-work-capsule-control-harness-design.md), [`2026-05-26-contributor-inventory-sync-design.md`](2026-05-26-contributor-inventory-sync-design.md), [`2026-05-31-grok-first-class-support-design.md`](2026-05-31-grok-first-class-support-design.md), [`2026-06-19-build-studio-sandbox-isolation-design.md`](2026-06-19-build-studio-sandbox-isolation-design.md)

---

## 1. Goal (operator intent, verbatim framing)

> "The progress indicator, process, evidence, documents etc. [in Build Studio] are valuable to see even if the external AI agent in Codex, Claude or Grok is working on a build. The ability to track this work is largely facilitated now through MCP calls, and we use the same sandbox where possible. Consolidate the facility for all development activity into Build Studio to include external AI agents. Access to the documents, the ability to have one AI agent client like Claude start an effort, and Grok to finish it should be possible."

Three concrete capabilities are being asked for:

1. **Cross-surface progress/evidence/document visibility** — when Claude/Codex/Grok (external CLI) does the work, its progress, process, evidence, and documents show up in the same Build Studio surfaces that an in-portal build does.
2. **Start-by-one / finish-by-another** — one agent begins an effort; a different agent picks it up with full context (documents, evidence, branch, sandbox) and finishes it.
3. **Shared sandbox where possible** — agents work the same workspace rather than disconnected copies.

This is **research-first**: the deliverable is this gap analysis + design + a phased backlog, not an implementation. It explicitly honors `verify-substrate-before-proposing-new` — the DPF substrate here is far denser than a first read suggests, and most of what's needed already exists but is **unbound**.

## 2. Research & Benchmarking (per AGENTS.md §10)

How do leading systems make work tracking provenance-agnostic and support cross-worker handoff? We read data models, not feature lists.

| System | Unit of work / model | Pattern adopted | Pattern rejected |
| --- | --- | --- | --- |
| **GitHub Checks/Status API** | A *check run* is keyed to a commit SHA; any number of external producers (CI providers, bots) POST check runs + annotations against the same SHA; the PR aggregates them into one timeline. | Evidence keyed to a **shared, stable work-unit identity** and rendered surface-agnostically — the literal embodiment of `governance-approves-evidence-not-provenance`. | Keying the timeline to the **SHA** (it changes every commit). DPF needs a unit stable *across* the whole ideate→ship lifecycle → the WorkCapsule, not the branch/build. |
| **Linear / Jira issue** | The *issue* is the durable anchor; branches, PRs, CI, deploys, comments attach via integrations; the issue timeline aggregates heterogeneous tool activity. | A **stable work-item anchor that aggregates heterogeneous activity** from many tools. WorkCapsule = the issue analog. | Anchoring the rich timeline on an ephemeral artifact (branch/build). DPF's `FeatureBuild` is closer to a "build run" than to the durable issue. |
| **Temporal / durable execution** | Workflow *identity* is durable and stable; *workers* are interchangeable and can resume a workflow another worker started; state is checkpointed. | **Start-by-one/finish-by-another**: capsule = the durable workflow identity; the capsule **lease** = the current worker; an `executor-changed` event = worker reassignment; recorded evidence = the checkpoint another agent resumes from. | Worker-pinned state (where only the original worker can continue) — exactly the failure mode of today's owner-only `PhaseHandoff`. |
| **OpenTelemetry trace/span** | A *trace* spans many services/agents; each span carries its producer's identity but rolls up to one trace id. | Activity/evidence records carry **producer identity** (principal + `executorKind`) but **roll up to the capsule** timeline. | One-trace-per-service silos. |
| **CI gate ("checks must be green")** | The merge gate reads the *evidence* (check conclusions), never *which bot* produced them. | Gate reads required evidence fields only — already DPF doctrine. | Gate logic that branches on the producing surface (couples the gate to the tool). |

**Gap the design fills (not found in any single benchmark):** none of these unify the *rich phase/evidence/document authoring experience* across heterogeneous **local** agents into one durable, kernel-governed work-unit that also carries a **shared sandbox** and **cross-agent handoff**. DPF's combination — WorkCapsule + governed MCP evidence + a shared build sandbox + lease-based handoff — is novel; the benchmarks validate each piece in isolation.

## 3. Current substrate map (what already exists)

The platform already has **two** development-tracking surfaces, anchored on **two different models**:

### 3.1 Build Studio `/build` — `FeatureBuild`-anchored (rich, BS-internal only)
- `FeatureBuild` (`packages/db/prisma/schema.prisma:4613`) carries `phase` (ideate/plan/build/review/ship), and the documents inline as JSON: `brief`, `designDoc`, `designReview`, `buildPlan`, `planReview`, `taskResults`, `verificationOut`, `acceptanceMet`, `scoutFindings`, `uxTestResults`.
- Provenance/history ledger: `BuildArtifactRevision` (`:4764`, append-only, `savedByAgentId`/`savedByUserId`/`threadId`).
- Activity feed: `BuildActivity` (`:5044`, `tool`/`summary`/`createdAt` — **no actor column**). Phase telemetry: `BuildPhaseRun` (`:5089`). Cross-phase context: `PhaseHandoff` (`:5113`, `fromAgentId`/`toAgentId`, decisions/openIssues/evidenceDigest).
- UI (`apps/web/components/build/`): `PhaseIndicator` (stepper), `BuildProgressOperationalPanel`, `BuildActivityLog`, `ReviewPanel` (document viewer), `UnifiedEvidenceTimeline`. Reads via `getBuildProgressVisibility` (`apps/web/lib/build/progress-visibility.ts:125`) + SSE on `threadId`.
- **Write path:** evidence/handoff tools (`saveBuildEvidence`, `save_phase_handoff`, `save_build_notes`) are **owner-gated, not orchestrator-gated** — `resolveActiveBuildId` matches `createdById === userId` (`apps/web/lib/mcp-tools.ts:5033`). So an external agent with the owner's token *can* write — but progress/activity that the UI shows is almost entirely emitted by the in-portal orchestrator during dispatch (`build-orchestrator.ts:1198/1562/1693`), and live refresh is `threadId`-bound SSE an external CLI can't push to (10s DB-poll fallback only).

### 3.2 `/platform/development/change-lanes` — `WorkCapsule`-anchored (cross-surface, inventory-only)
- `WorkCapsule` (`schema.prisma:1036`) is the **executor-agnostic** unit: `executorKind` (`build-studio | claude-desktop | codex-desktop | grok-desktop | human | git-webhook | dpf-native | opencode`), `executorRef`, lease fields (`leaseHolderPrincipalId`, `leaseExpiresAt`), soft links (`backlogItemId`, `epicId`, `featureBuildId`, `taskRunId`), git/PR/sandbox cache, `scopeClaims`. Activity: `WorkCapsuleActivity` (`:1092`, 26 kinds incl. `evidence-recorded`, `executor-changed`).
- Lifecycle: `draft → ready → working → blocked → verifying → ready-for-review → ready-for-promotion → complete → abandoned → archived` (`apps/web/lib/work-capsules.ts`).
- 10 MCP tools (create/adopt/plan-worktree/claim-scope/heartbeat/status/release/evidence/get/list) — `apps/web/lib/work-capsules/mcp-handlers.ts`. BS auto-attaches a capsule (`build-studio-attachment.ts:42`, called at `build.ts:109`/`governed-backlog-tee-up.ts:317`).
- **Cross-surface read model already exists**: `contributor-change-lanes/read-model.ts:105` projects WorkCapsule + RuntimeTarget + RuntimeVerification + nonprod-lease (live) + git-worktree/git-branch/github-pr (synced snapshots) into unified "lanes" at `/platform/development/change-lanes` (admin, read-only). Spec: `2026-05-26-contributor-inventory-sync-design.md`.

### 3.3 External-agent evidence — a third, orphaned silo
- `record_external_development_evidence` (`mcp-tools.ts:6741`) writes `ExternalEvidenceRecord` (`schema.prisma:4558`) — `provider` (self-declared string), `externalSessionId` (free text), optional **soft, usually-unset `buildId`** (a plain String, not an FK), no `workCapsuleId`. Captures **no agentId** — only `actorUserId`.
- Its only readers are the AI operations map (`lib/ai-operations-map/load-map-data.ts:232`) and skill evidence search. **No Build Studio progress surface reads it.** The `UnifiedEvidenceTimeline`'s "external"/"codex" lane is **faked** from `FeatureBuild.codingProvider` (the CLI the *internal* orchestrator spawned in its own sandbox), not from real external records (`WorkflowStageInspector.tsx:137`).
- Sibling external-evidence tools land in yet other stores: `record_capsule_evidence`→`WorkCapsuleActivity`; `record_execution_evidence`/`record_functional_failure_evidence`→`BacklogItemActivity`; `record_runtime_verification`→`RuntimeVerification` (the one with real `featureBuildId`/`workCapsuleId` FKs — but no BS surface reads it either).

### 3.4 The sandbox is two physically distinct things
- **BS sandbox** = a single long-lived Docker container `dpf-sandbox-1` holding one shared git tree at `/workspace` (volume `dpf_sandbox_workspace`). Reachable from outside **only** via build-scoped MCP tools (`run_sandbox_command`/`*_sandbox_file`, `mcp-tools.ts:9780+`), and **only while a build is active** (`resolveActiveBuildId`). The CLIs BS "uses" (claude/codex/grok) run *inside* this container via `docker exec` (`claude-dispatch.ts:273`) — they are BS's code engine, not the user's machine CLI.
- **Desktop-CLI workspace** = a **host** git worktree under `D:\DPF-worktrees\<topic>` planned by `plan_capsule_worktree`/`adopt_worktree`. The user's Claude/Codex/Grok edits files here with their own filesystem tools.
- **There is no shared mount between them.** Per-build worktree isolation (`/workspace/.builds/<buildId>`) is built but **dormant** behind `DPF_BUILD_WORKTREE_ISOLATION=1` (`build-branch.ts:135`).

### 3.5 Clients, identity, webhooks, dispatch
- **Config/bootstrap** (`scripts/dpf-bootstrap-agent-toolchain.{ps1,sh}`, `packages/dpf-bootstrap/src/agent-toolchain/`): all three CLIs read one shared bearer token from `DPF_MCP_BEARER_TOKEN`; `.mcp.json` (Claude), `~/.codex/config.toml` (Codex), `~/.grok/config.toml` (Grok) reference the env var. MCP endpoint `/api/mcp/v1`.
- **Identity is thin:** one shared token; `ToolExecution` attributes by token-user, not by which agent. WorkCapsule/RuntimeVerification resolve a converged `Principal`/`PrincipalAlias` (§11); but `ExternalEvidenceRecord`/`BuildActivity`/`BacklogItemActivity` store raw strings. External coding-agent PATs typically carry `agentId = null`.
- **Webhooks/events:** inbound HTTP — GitHub git-updates (HMAC) → Inngest `build/git-update.received`; Grafana alerts; Postmark email; public quality reports; edge events (bearer); and `/api/mcp/v1`. Build Studio is **Inngest-driven** (`build/execute.run`, concurrency-keyed per `buildId`, crash-durable). **There is no generic event-ingest route and external agents never call `inngest.send()`** — the sanctioned inbound channel for external progress/evidence is **MCP tool calls**.
- **Dispatch seam:** `build-studio-config.ts` selects which engine runs a BS build *inside the sandbox* (claude/codex/grok/opencode/agentic). This is **not** a router that sends work to a CLI on the user's machine — no such router exists.

## 4. Gap analysis

| # | Gap | Evidence | Severity |
| --- | --- | --- | --- |
| G1 | **External-agent evidence never surfaces in Build Studio.** `ExternalEvidenceRecord` is write-only w.r.t. `/build`; the "external" lane is faked from `codingProvider`. | `mcp-tools.ts:6741`, `WorkflowStageInspector.tsx:137`; no BS reader joins `ExternalEvidenceRecord`. | High — defeats capability #1. |
| G2 | **No universal work-unit binding.** Evidence is fragmented across `ExternalEvidenceRecord` / `WorkCapsuleActivity` / `BacklogItemActivity` / `RuntimeVerification` / `BuildActivity`; the links to a build/capsule are soft, optional Strings, usually unset. | `schema.prisma:4558` (`buildId String?`), `1047` (`featureBuildId String?`). | High. |
| G3 | **Start-by-one/finish-by-another is unbuilt.** `executor-changed` activity kind is **defined but has zero writers** (one hit across `apps/web`, the definition). No `executorKind` mutation path after create/adopt; no lease-transfer/propose-acknowledge protocol. `PhaseHandoff` is owner-only + FeatureBuild-bound, so agent B cannot pick up agent A's build. | `work-capsules.ts:45`; `mcp-tools.ts:5033`. | High — defeats capability #2. |
| G4 | **WorkCapsule ⟷ FeatureBuild not auto-linked, and the capsule has no phase/evidence/document timeline.** Externally adopted capsules get no FeatureBuild; the capsule carries no `phase`/documents; the rich UI is FeatureBuild-only. | `work-capsule-store.ts:205`; `schema.prisma:1036` (no phase/document fields). | High. |
| G5 | **No shared sandbox between host CLIs and the BS container.** `/workspace` is container-only; desktop CLIs only touch host worktrees; no mount/remote bridges them. Per-build isolation dormant. | `build-branch.ts:32/135`; `2026-06-19-build-studio-sandbox-isolation-design.md`. | Medium — capability #3 is "where possible". |
| G6 | **Live progress for external work has no push channel.** UI freshness is `threadId`-bound SSE (`agentEventBus`); external CLIs can't push; only 10s DB-poll catches up. | `mcp-tools.ts:8384`; `BuildStudio.tsx`. | Medium. |
| G7 | **Tracking is voluntary; no auto-claim at work-start for external agents.** BS auto-attaches a capsule; external CLIs don't. Routing adapters, bootstrap, and skill-pack contain no capsule step; the "if it isn't in the MCP plane it didn't happen" rule has no runtime gate for external agents. | no capsule refs in `routing/*`, bootstrap, `dpf-skill-pack`. | High — without it, capabilities #1–2 stay empty. |
| G8 | **Thin/shared identity.** One shared token; `ExternalEvidenceRecord` stores no agentId; inconsistent principal linking. Can't reliably say "Grok wrote the plan." | `external-evidence.ts:16`; `mcp-tools.ts:6750`. | Medium. |
| G9 | **Doc/contract gaps.** AGENTS.md §17 says "three peer surfaces" but **four CLIs ship — Grok is unnamed in the process model**; no "claim a capsule before you work" or "resume someone else's capsule" instruction; lease-guard hook binds only Claude Code (Codex/Grok "comply by construction", BI-6B02FEE5). | `AGENTS.md:256`, `:267`. | Medium. |

**Net:** This is a **binding** problem, not a new-substrate problem. The WorkCapsule (executor-agnostic, leased, already feeding a cross-surface view), the evidence tools, the runtime spine, the rich BS UI, the dispatch seam, and the kernel doctrine all exist. What's missing is the wiring that makes external-agent activity land on a **single universal work-unit** that the progress/evidence/document surfaces render, plus the **handoff writer** that the start-by-one/finish-by-another requirement literally needs.

## 5. Architectural decision — the universal unit is the WorkCapsule

**Decision:** Anchor the unified progress/evidence/document timeline on the **WorkCapsule** (Option A). `FeatureBuild` remains the Build-Studio-*internal* execution detail that attaches to a capsule; the capsule is the surface-agnostic anchor that every effort — BS or external CLI — shares.

Options considered:
- **A — Capsule-anchored timeline** *(chosen)*. Add a `phase` + a unified, capsule-linked evidence/document/activity timeline; render progress/evidence/documents from the capsule (BuildActivity+artifacts when a FeatureBuild is linked, plus external evidence, runtime verification, phase handoffs). Handoff = `executor-changed` writer + lease transfer.
- **B — Build-anchored shadow.** Give every external effort a lightweight `FeatureBuild` shadow and write into the existing build tables. *Rejected:* `FeatureBuild` is heavily BS-internal (sandbox/orchestrator/dispatch/Inngest); external efforts that never touch the sandbox would carry empty execution machinery, and it demotes the already-cross-surface WorkCapsule to a side link — violating `single-source-of-truth` and `architecture-over-shortcuts`.
- **C — Read-only projection bridge.** Join the existing stores into one read-only timeline; change no write model. *Adopted as the Phase-1 increment of A, not as the end state*, because it does **not** deliver start-by-one/finish-by-another (G3) and leaves the fragmented write path (G2) so the join stays brittle and mostly empty.

**Kernel rationale** (the governed advisory tool `principle_decide` errored on every call this session — it rejected the valid `callingPopulation` enum values `human` and `external_coding_agent` three times; captured as a defect BI, so this rationale is reasoned directly from the kernel, not fabricated from a tool score):
- `mcp-is-the-coordination-plane` + `governance-approves-evidence-not-provenance` → the WorkCapsule *is* the MCP coordination object; capsule-anchored evidence is surface-agnostic by construction. **→ A.**
- `single-source-of-truth` → one tracking unit, not FeatureBuild-for-BS + ExternalEvidenceRecord-for-external in parallel. **→ A** (C leaves two; B inverts which is canonical).
- `one-common-process-three-surfaces` → one lifecycle across surfaces, anchored on the shared capsule. **→ A.**
- `architecture-over-shortcuts` → C alone is the shortcut that skips handoff. **→ A over C.**
- `verify-substrate-before-proposing-new` + `schema-audit-before-features` → A reuses `executorKind`, the lease, and the change-lanes feed rather than inventing; B would duplicate identity into FeatureBuild shadows. **→ A.**

## 6. Target design

### 6.1 The capsule as the universal work timeline
- Add to `WorkCapsule`: a `phase` (reuse the ideate→ship vocabulary; `null`/`adhoc` for efforts that don't run the full lifecycle) and a derived **status projection** (the Daily-Steward reconciler from the harness spec, still Phase-4-unbuilt) so capsule status reflects linked BacklogItem/FeatureBuild/PR state instead of only manual sets.
- Introduce a **capsule timeline projection** that merges, by `workCapsuleId`: `WorkCapsuleActivity` (incl. evidence), the linked `FeatureBuild`'s `BuildActivity` + `BuildArtifactRevision` (documents/history), `ExternalEvidenceRecord`, `RuntimeVerification`, and `PhaseHandoff`. This is the data pipeline behind the already-existing `UnifiedEvidenceTimeline` *component* (which today is fed only FeatureBuild columns).
- **Documents:** capsule-linked efforts expose the same document set (brief/design/plan/handoffs) — sourced from the linked FeatureBuild when present, or from capsule evidence entries of a `document` kind for FeatureBuild-less external efforts.

### 6.2 Bind external evidence to the capsule (G1/G2/G8)
- Add `workCapsuleId` (real, indexed) to `ExternalEvidenceRecord`; have `record_external_development_evidence` resolve/require a capsule (auto-resolve from the caller's active lease; create-or-adopt if absent). Capture the producing **principal** (via `ensureAgentPrincipalIdentity`) + `executorKind`, not just a self-declared `provider` string.
- On external-evidence write: append a `WorkCapsuleActivity` (so it lands on the unified timeline) and, when a FeatureBuild is linked, a `BuildActivity` + emit the live-update event (see 6.4). Validate the caller may act on the supplied capsule/build before writing (close the missing ownership check at `mcp-tools.ts:6768`).

### 6.3 Start-by-one / finish-by-another (G3) — the headline capability
- Implement the **`executor-changed` writer**: a governed `reassign_capsule_executor` path (or extend `update_work_capsule_status`) that mutates `executorKind`/`executorRef`, transfers the lease (`leaseHolderPrincipalId`), and writes the `executor-changed` `WorkCapsuleActivity` with from/to executor + reason.
- Define a **propose → acknowledge → adopt** protocol so a handoff is an explicit, audited transfer (not silent lease-expiry reclaim): agent A calls "offer handoff" (records a handoff manifest reusing `PhaseHandoff`/`save_phase_handoff` content — decisions, open issues, evidence digest, next action); agent B `adopt`s, taking the lease + continuing from the recorded evidence/documents/branch. Generalize `PhaseHandoff` beyond owner-only/FeatureBuild-bound so a *different* principal can resume.
- Result: "Claude starts an effort, Grok finishes it" = capsule created by `claude-desktop` → evidence/handoff recorded → `executor-changed` to `grok-desktop` → Grok adopts the capsule, reads the documents/evidence, continues on the same branch.

### 6.4 Live progress for external work (G6)
- Add a capsule/build-keyed event channel (extend `agentEventBus` keying from `threadId` to also accept `workCapsuleId`/`buildId`) so capsule writes push to any open progress view; keep the DB-poll as the degraded fallback. No new inbound webhook is needed — **MCP remains the inbound channel** (§3.5).

### 6.5 Shared sandbox posture (G5) — "where possible", explicitly staged
- **Near-term (no infra change):** external CLIs continue to work in **host worktrees** governed by the capsule (`plan_capsule_worktree`/`adopt_worktree` + scope claims). Two agents on one effort share the *capsule and branch*, reconverging at git — not a shared live filesystem. This already works and is the safe default.
- **Optional later:** to let an external CLI drive the **same BS `/workspace`**, either (a) finish + default-on per-build worktree isolation (`DPF_BUILD_WORKTREE_ISOLATION`) and expose `run_sandbox_command`/`*_sandbox_file` to a capsule-scoped external token (multi-tenant-safe per build), or (b) run BS builds in a host worktree the same way desktop CLIs do and let `adopt_worktree` + scope-claims arbitrate. Both are **operator-gated infra decisions** (open question O3) — not required for capabilities #1–2.

### 6.6 AGENTS.md & client contract (G7/G9)
- **Name Grok** as a peer surface in §17 (four CLIs ship; doctrine says three).
- Add an external-agent **work-start contract**: claim/adopt a capsule before working; record evidence at phase boundaries; release on exit — with **graceful degradation** (if MCP is unreachable, work proceeds and reconciles later; never hard-block, honoring "work never depends on any one surface being healthy").
- Add a **resume-someone-else's-capsule** procedure (discover in-flight capsule → offer/accept handoff → adopt lease → continue).
- Seed the contract into the bootstrap + the `dpf-platform` skill-pack so it's the path of least resistance, not just prose. Track the Codex/Grok lease-guard parity (BI-6B02FEE5) as the enforcement-by-construction follow-on.

## 7. Local-client concerns & risks (explicit, per operator ask)

1. **Identity is shared-token and spoofable.** All CLIs use one `DPF_MCP_BEARER_TOKEN`; `executorKind`/`provider` are self-reported. Reliable "which agent did this" needs per-actor principal binding (substrate exists: `createdByPrincipalId`/`leaseHolderPrincipalId`); minimally, bind the executor to the lease holder's principal and stop trusting the free-text `provider`.
2. **Worktree-location mismatch is live.** §17 mandates `D:\DPF-worktrees\<topic>`; this very session runs in `.claude/worktrees/<random>` — the nesting §17 calls "a hard error." Capsule tracking must reconcile where the worktree actually is vs. the convention, or it mis-attributes lanes.
3. **Sandbox ownership ambiguity.** A host CLI edits a host worktree; BS dispatch + Grok device-login run in `dpf-sandbox-1`. "All dev flows into BS tracking" means tracking **host worktree** state for external agents (already modeled by `record_external_development_evidence` `changedFiles`/`localIntegration`), not container state — don't conflate the two.
4. **Lease-guard asymmetry.** The `PreToolUse` lease-guard hook only binds Claude Code; Codex/Grok have no harness enforcement (BI-6B02FEE5). Tightened tracking can't be hook-enforced for them yet; rely on contract + the shared `dpf worktree` wrapper when it lands.
5. **Don't break solo workflows / never hard-block.** Today an external CLI can do useful work with zero capsule overhead. A *mandatory* capsule-claim that hard-fails when the portal/MCP is down would violate "work never depends on any one surface being healthy." Capsule-claim must **degrade gracefully** and reconcile, not gate local editing.
6. **Token rotation/scope churn.** Requiring evidence writes adds a `write`-token dependency to every session; rotation needs env-var update + `/api/mcp/token/refresh` + restart + per-worktree re-sync. Under-provisioned tokens already strand sessions (BI-A3DE9A31); tightening tracking raises the blast radius — keep auto-mint + clear scope-escalation UX.

## 8. Phasing (proposed)

- **Phase 0 — quick, safe wins (no migration):** name Grok in §17; add the external-agent work-start + resume contract to AGENTS.md + skill-pack; add the missing `buildId`/capsule ownership check on `record_external_development_evidence`.
- **Phase 1 — unified read (Option C as a subset of A):** capsule timeline projection that merges the existing stores; render it in `/build` (when a capsule has a FeatureBuild) and in the capsule detail view; stop faking the external lane from `codingProvider`. Immediate visibility win for capability #1.
- **Phase 2 — write-model binding (G1/G2/G8):** `workCapsuleId` FK on `ExternalEvidenceRecord`; external evidence resolves/creates a capsule, records principal + executor, and bridges to `WorkCapsuleActivity` (+ `BuildActivity` when linked); auto-claim/adopt at external work-start with graceful degradation (G7).
- **Phase 3 — handoff (G3, the headline):** `executor-changed` writer + propose/acknowledge/adopt lease-transfer + generalized cross-principal `PhaseHandoff`. Delivers start-by-one/finish-by-another.
- **Phase 4 — live + derived status (G6):** capsule/build-keyed event channel; the Daily-Steward status reconciler.
- **Phase 5 — shared-sandbox posture (G5):** operator decision on container-vs-host sharing; finish/flip per-build worktree isolation if container-sharing is chosen.

## 9. Proposed backlog (EP-UNIFIED-TRACKING — filed 2026-06-19)

1. **[BI-DBC7E40C] (Phase 0, doc)** AGENTS.md §17: name Grok as a 4th peer surface + add the external-agent capsule work-start & resume-handoff contract; seed into bootstrap + skill-pack.
2. **[BI-4196AB21] (Phase 0, bug)** `record_external_development_evidence`: validate caller may act on the supplied `buildId`/capsule before writing.
3. **[BI-C25374E4] (Phase 1, feature)** Capsule unified-timeline projection (merge WorkCapsuleActivity + linked BuildActivity/artifacts + ExternalEvidenceRecord + RuntimeVerification + PhaseHandoff); render in `/build` + capsule detail; retire the faked external lane.
4. **[BI-6357B975] (Phase 2, feature)** Add `workCapsuleId` to `ExternalEvidenceRecord`; resolve/create a capsule on external-evidence write; capture principal + executorKind; bridge to capsule (+ build) activity.
5. **[BI-636A11B3] (Phase 2, feature)** External-agent **auto-claim/adopt a capsule at work-start** with graceful degradation; seed into routing adapters + skill-pack.
6. **[BI-51787ECD] (Phase 3, feature)** `executor-changed` writer + propose/acknowledge/adopt lease-transfer protocol; generalize `PhaseHandoff` for cross-principal resume. **(Headline: start-by-one/finish-by-another.)**
7. **[BI-8F83933B] (Phase 4, feature)** Capsule/build-keyed live-update channel (extend `agentEventBus`) + Daily-Steward derived-status reconciler.
8. **[BI-410024ED] (Phase 5, chore)** Shared-sandbox posture decision + (if chosen) finish/default-on per-build worktree isolation for safe multi-agent sandbox sharing.
9. **[BI-11E6542D → EP-PRINCIPLES] (defect)** `principle_decide` MCP tool rejects valid `callingPopulation` enum values (`human`, `external_coding_agent`) — governed decision surface is currently unusable.

## 10. Open decisions for the operator

- **O1 — New epic vs. extend EP-CAPSULE?** Recommend a new **EP-UNIFIED-TRACKING** (this spans capsule + build UI + evidence + routing + sandbox + AGENTS.md; no single existing epic owns all), explicitly extending EP-CAPSULE's substrate. (If you prefer, fold under EP-CAPSULE.)
- **O2 — Mandatory vs. advisory capsule-claim for external agents.** Recommend **advisory + graceful-degrade** first (don't break solo/offline workflows), tightening to enforced-by-construction once the Codex/Grok `dpf worktree` wrapper (BI-6B02FEE5) lands.
- **O3 — Shared-sandbox appetite.** Is the near-term **host-worktree + git reconvergence** model sufficient for "same sandbox where possible", or do you want to invest in exposing the BS container `/workspace` to external CLIs (Phase 5, infra-gated)?
- **O4 — Scope of this `/goal`:** is the deliverable the spec + backlog (research-first, as framed), or should Phase 0 ship in this session?
