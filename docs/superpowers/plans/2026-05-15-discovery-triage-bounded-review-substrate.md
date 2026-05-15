# Discovery Triage Bounded Review Substrate Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse the Hive Scout v2 bounded autonomous-review substrate in discovery triage without duplicating scheduler, provider, rate-limit, or UI architecture.

**Architecture:** Discovery triage keeps deterministic mechanics in procedural code: entity selection, evidence packet construction, confidence scoring, taxonomy-node resolution, idempotency, auto-apply, and `DiscoveryTriageDecision` writes. The bounded reviewer is only allowed to classify already-ambiguous packets into a small schema-validated routing annotation. Shared TAK helpers own failure taxonomy, runtime disable, auto-pause health, egress allowlist checks, and schema-drop counting.

**Tech Stack:** Next.js 16, Vitest, Prisma 7, DPF routed inference, scheduled TaskRun summaries, shared `apps/web/lib/tak/bounded-autonomous-review.ts`.

---

## Repo Truth

- Current discovery triage already has `run_discovery_triage`, `runDiscoveryTriageDaily`, idempotent daily keys, TaskRun scheduling, and summary extraction.
- Current procedural decisions live in `packages/db/src/discovery-triage.ts` and `apps/web/lib/discovery-triage-runner.ts`.
- The shared substrate from Hive Scout v2 already exists at `apps/web/lib/tak/bounded-autonomous-review.ts`.
- Live MCP planning context found open blocker `BI-942F3D00`, where cadence triage previously failed on a stale `selectedTaxonomyNodeId` foreign key. Current code already resolves selected taxonomy candidates through a DB lookup before writes; this slice must not weaken that guard.

## Deterministic vs Reviewer Work

Deterministic procedural code:

- Query unresolved and weakly resolved `InventoryEntity` rows.
- Build evidence packets and compute identity, taxonomy, evidence, and reproducibility scores.
- Resolve candidate taxonomy identifiers to real `TaxonomyNode.id` values before writes.
- Auto-apply only existing taxonomy matches that satisfy procedural thresholds.
- Persist `DiscoveryTriageDecision` rows and idempotency metadata.
- Report scheduled run summaries and TaskRun progress.

Ambiguous reviewer work:

- For non-auto-applied packets only, choose a bounded classification: `accept_procedural_outcome`, `force_human_review`, `needs_more_evidence`, `taxonomy_gap`, or `dismiss`.
- Provide a short rationale for operator review and later proceduralization.
- Never fetch, parse, dedupe, write, select providers, retry rate limits, or introduce a new taxonomy node.

## Smallest Slice

- [ ] Add focused tests in `apps/web/lib/discovery-triage-runner.test.ts` for injected reviewer decisions, schema drops, typed failure reasons, runtime disable, and egress allowlist shape.
- [ ] Add focused summary coverage in `apps/web/lib/actions/agent-task-scheduler.test.ts` for discovery review metrics in scheduled TaskRun summaries.
- [ ] Modify `apps/web/lib/discovery-triage-runner.ts` to use shared bounded-review helpers for settings, health, egress, schema validation, typed failures, and metrics.
- [ ] Modify `apps/web/lib/actions/agent-task-scheduler-summary.ts` to include discovery review metrics in payload and compact status.
- [ ] Wire `run_discovery_triage` in `apps/web/lib/mcp-tools.ts` to enable the bounded reviewer on the governed tool path. Direct runner callers remain deterministic unless they opt in.
- [ ] Add a prompt fragment only if the default TAK reviewer is enabled in this slice; no new UI, schema, seed tables, provider selection, or rate-limit code.

## Verification

- `pnpm --filter web exec vitest run lib/discovery-triage-runner.test.ts lib/actions/agent-task-scheduler.test.ts lib/mcp-tools.test.ts`
- `pnpm --filter web typecheck`
- `pnpm --filter web build` if TypeScript or runtime imports touch production web build paths.
- Live receipt check only if the running install is safe to mutate; otherwise record why it was skipped.
