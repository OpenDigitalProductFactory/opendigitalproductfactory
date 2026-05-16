# Hive Scout v3 Proceduralization Loop Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-05-15
**Spec:** [`docs/superpowers/specs/2026-05-11-hive-scout-autonomous-coworker-design.md`](../specs/2026-05-11-hive-scout-autonomous-coworker-design.md) — implements **Slice 3** of that spec.
**Branch:** `plan/hive-scout-v3-proceduralization` off `origin/main` (per [`AGENTS.md`](../../../AGENTS.md) §4). The implementation branch will be `feat/hive-scout-v3` once a coworker picks this up.
**Predecessor:** Slice 2 closed via [#620](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/620), [#624](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/624), [#627](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/627), [#630](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/630). The reviewer-decision rows this slice mines are flowing from production today.

**Goal:** Stop re-solving the same archetype decisions forever. Mine the `BacklogItemActivity.payload.ambiguityReview` rows produced by Slice 2; promote stable patterns into deterministic code, deterministic pre-filters, or recorded capability needs — each promotion gated by a human-approved backlog item, never auto-merged.

**Architecture:** Slice 3 is a read-only mining layer over the evidence Slice 2 already persists, plus a write path that emits `BacklogItem` rows of `source: "hive-scout-proceduralization"` so a human approves before any code or pre-filter changes land. No new tables. No new substrate. Reuses `BacklogItem`, `BacklogItemActivity`, `CoworkerCapabilityNeed`, and the existing `proceduralization-candidate` source kind already known to capacity-continuity ([`apps/web/lib/capacity-continuity/candidates.ts:16,25`](apps/web/lib/capacity-continuity/candidates.ts:16)).

**Tech Stack:** Next.js 16, Vitest, Prisma 7, scheduled coworker runtime, MCP governed tool execution. No new external dependencies.

**Non-negotiable invariants:**

- **Read-only mining.** The mining functions never write to `BacklogItemActivity`, never modify Slice 2's evidence rows, and never call the LLM provider. Mining is pure SQL/Prisma over already-persisted data.
- **Promotion is a proposal, not an enactment.** Every promotion candidate becomes a `BacklogItem` of `source: "hive-scout-proceduralization"` and `status: "deferred"` (human-approval gate). Slice 3 never edits `INDUSTRY_TO_VALUE_STREAM` directly, never adds rows to `CoworkerCapabilityNeed` for capabilities the operator hasn't acknowledged, never installs deterministic pre-filters at runtime without operator action.
- **Confidence-gated.** No proposal is emitted unless the underlying pattern has both (a) `≥ minSampleSize` reviewer decisions on the same axis (default 5) and (b) `≥ minAgreementFraction` consistency (default 0.8). Both knobs are operator-tunable via `PlatformConfig` keys under the `hive-scout.proceduralization.*` namespace.
- **Idempotent proposals.** Re-running the miner against the same evidence MUST NOT create duplicate proposals. Each candidate carries a stable `proposalKey` (e.g., `industry-mapping:devops`); existing open proposals with the same key are updated in place rather than re-created.
- **Mining cadence is decoupled from ingest.** Mining runs on its own scheduled task — `external-catalog-scout` already owns one task; Slice 3 adds a sibling task or extends the existing one. Mining MUST NOT block, slow, or share locks with the ingest pipeline.
- **Public-data egress only.** Mining touches only DPF-internal evidence; no external calls. The Slice 2 egress allowlist is unaffected.
- **No new DB tables, no new migrations, no new identity entities.**

---

## Repo Truth (verified 2026-05-15)

- **Reviewer evidence is on disk.** [`apps/web/lib/actions/hive-scout/ingest-500-agents.ts:179-192,734-747`](apps/web/lib/actions/hive-scout/ingest-500-agents.ts:179) persists `BacklogItemActivity.payload.ambiguityReview` matching spec §5.3 exactly. Outer payload also carries `taskRunId`, `catalog`, `catalogLicense`, `sourceUrl`, `sourceUrlHash` (sha256, useful for grouping), `framework`, deterministic `valueStream`, and `valueStreamConfidence`.
- **Skipped entries leave no evidence row.** When the reviewer classifies as `duplicate_pattern` or `out_of_scope`, the candidate is never written to backlog ([line 707-710](apps/web/lib/actions/hive-scout/ingest-500-agents.ts:707)). Those decisions exist only in the per-run `skippedByReview` summary metric. **Implication for Slice 3:** the out-of-scope mining axis cannot read individual decisions from `BacklogItemActivity` — it must aggregate the run-summary metric over time, OR Slice 2 must be amended to persist a summary-level breakdown (see §Open Decisions).
- **`INDUSTRY_TO_VALUE_STREAM` is a single-site code constant** at [`ingest-500-agents.ts:56-93`](apps/web/lib/actions/hive-scout/ingest-500-agents.ts:56) — `Record<string, string>`, 33 entries, 7 IT4IT value streams. Looked up once per candidate via [`mapIndustryToStream()`](apps/web/lib/actions/hive-scout/ingest-500-agents.ts:327). No DB-backed override exists today.
- **Pre-filter seam exists** between [`isGap()` at line 373](apps/web/lib/actions/hive-scout/ingest-500-agents.ts:373) and the reviewer call at line 654-657. A new filter step can slot in between without touching the deterministic dedupe.
- **`CoworkerCapabilityNeed` already exists** in [`packages/db/prisma/schema.prisma:1748-1776`](packages/db/prisma/schema.prisma:1748) with full shape: `agentId`, `kind`, `severity`, `status`, `need`, `blocks`, `evidenceJson`, `linkedBacklogItemId`, `duplicateOfId`. No migration needed.
- **`proceduralization-candidate` is a recognized source kind** in [`apps/web/lib/capacity-continuity/candidates.ts:16,25`](apps/web/lib/capacity-continuity/candidates.ts:16). The capacity-continuity scheduler already knows how to surface these.
- **AI Operations Map already projects backlog evidence generically** through [`apps/web/lib/ai-operations-map/load-map-data.ts:156`](apps/web/lib/ai-operations-map/load-map-data.ts:156) and [`projectBacklogEvidence()`](apps/web/lib/ai-operations-map/project-events.ts:294). New proposals automatically appear there with no UI work.

## Out of scope for this slice

- Auto-applying any promotion to code or to `PlatformConfig`. Every proposal goes through the backlog-item approval gate.
- New schema. `CoworkerCapabilityNeed`, `BacklogItem`, `BacklogItemActivity` are sufficient.
- Burn-rate-aware scheduling for the miner — Slice 4 owns that.
- Mining decisions across multiple installs. The hive-mind cross-install learning loop is its own design discussion.
- Any UI changes. Operations Map projects new proposals through the existing generic backlog-evidence projection.
- Re-classifying entries Slice 2 already wrote — Slice 3 is additive.

## File Structure

- Add: [`apps/web/lib/actions/hive-scout/proceduralization-miner.ts`](apps/web/lib/actions/hive-scout/proceduralization-miner.ts)
  - Read-only mining functions (one per axis: industry-mapping, out-of-scope, capability-need). Each function returns typed `ProceduralizationProposal[]`. No DB writes from this module.
- Add: [`apps/web/lib/actions/hive-scout/proceduralization-miner.test.ts`](apps/web/lib/actions/hive-scout/proceduralization-miner.test.ts)
  - Unit coverage per axis: confidence threshold gating, idempotency, empty-evidence handling.
- Add: [`apps/web/lib/actions/hive-scout/proceduralization-emitter.ts`](apps/web/lib/actions/hive-scout/proceduralization-emitter.ts)
  - Write path. Takes `ProceduralizationProposal[]` and `tx: PrismaClient`, upserts `BacklogItem` rows with `source: "hive-scout-proceduralization"`, idempotent on `proposalKey`. Also writes `CoworkerCapabilityNeed` rows where the proposal axis is `capability-need` and an open need with the same `(agentId, kind)` doesn't already exist.
- Add: [`apps/web/lib/actions/hive-scout/proceduralization-emitter.test.ts`](apps/web/lib/actions/hive-scout/proceduralization-emitter.test.ts)
  - Idempotency under repeat runs; backlog-item shape; capability-need dedupe.
- Modify: [`apps/web/lib/actions/hive-scout/ingest-500-agents.ts`](apps/web/lib/actions/hive-scout/ingest-500-agents.ts)
  - Add an optional pre-filter hook between `isGap()` and the reviewer call: `proceduralPrefilter?: (candidate: GapCandidate) => { skip: true; reason: string } | { skip: false }`. Default no-op. Slice 3's runner injects a real filter sourced from approved proposals; the production code stays neutral.
  - Add a per-run telemetry counter `skippedByPrefilter` (mirrors `skippedByReview`) so operators can see prefilter effectiveness.
- Modify: [`apps/web/lib/actions/hive-scout/ingest-500-agents.test.ts`](apps/web/lib/actions/hive-scout/ingest-500-agents.test.ts)
  - Cover the prefilter hook: default no-op preserves Slice 2 behavior; an injected prefilter that returns `{skip:true}` bypasses both review and backlog write and increments the counter.
- Add: [`apps/web/lib/actions/hive-scout/proceduralization-runner.ts`](apps/web/lib/actions/hive-scout/proceduralization-runner.ts)
  - Composes miner + emitter into a single `runProceduralizationMining()` entry point. Loads thresholds from `PlatformConfig`, calls each axis miner, dedupes against open proposals, calls the emitter inside a single transaction.
- Add: [`apps/web/lib/actions/hive-scout/proceduralization-runner.test.ts`](apps/web/lib/actions/hive-scout/proceduralization-runner.test.ts)
  - End-to-end test: seed evidence rows, run mining, assert proposals written; re-run, assert no duplicates.
- Modify: [`packages/db/src/seed-hive-scout.ts`](packages/db/src/seed-hive-scout.ts)
  - Seed a second scheduled task `hive-scout-proceduralization-mining` owned by the same `external-catalog-scout` agent, daily cadence, that calls `runProceduralizationMining()`. Active by default per the bundled-services-active rule.
- Modify: [`packages/db/src/seed-hive-scout.test.ts`](packages/db/src/seed-hive-scout.test.ts)
  - Assert the second scheduled task is seeded with the right cadence and the same agent.
- Modify: [`apps/web/lib/mcp-tools.ts`](apps/web/lib/mcp-tools.ts)
  - Add a governed `run_hive_scout_proceduralization_mining` tool so an operator can trigger the miner manually (mirrors `run_hive_scout_ingest`). Same `enableAutonomousReview`-style opt-in pattern is **not** needed here — mining has no LLM path — but the tool exists so the surface is auditable.
- Modify: [`apps/web/lib/mcp-tools.test.ts`](apps/web/lib/mcp-tools.test.ts)
  - Cover the new tool surface.

No schema changes. No new prompts (mining is pure code, no LLM call).

## Task 1: Define the proposal contract

- [ ] Write failing tests showing the miner returns typed `ProceduralizationProposal` objects with discriminated union over the three axes.
- [ ] Add the exported types in `proceduralization-miner.ts`:

  ```ts
  export type ProceduralizationProposal =
    | IndustryMappingProposal
    | OutOfScopeProposal
    | CapabilityNeedProposal;

  export type ProposalAxis = ProceduralizationProposal["axis"];

  export type ProposalConfidence = {
    sampleSize: number;          // how many decisions backed this proposal
    agreementFraction: number;   // 0.0–1.0
    minSampleSize: number;       // threshold in effect when proposal was emitted
    minAgreementFraction: number;// threshold in effect when proposal was emitted
  };

  export type IndustryMappingProposal = {
    axis: "industry-mapping";
    proposalKey: string;         // e.g., "industry-mapping:devops"
    industry: string;
    proposedValueStream: string; // the reviewer's repeated suggestion
    currentDeterministicMapping: string | null; // what INDUSTRY_TO_VALUE_STREAM says today
    confidence: ProposalConfidence;
    evidenceTaskRunIds: string[]; // up to 10 most recent backing task runs
  };

  export type OutOfScopeProposal = {
    axis: "out-of-scope";
    proposalKey: string;         // e.g., "out-of-scope:framework=research-only"
    matcher: { kind: "framework"; value: string } | { kind: "industry"; value: string };
    confidence: ProposalConfidence;
    evidenceTaskRunIds: string[];
  };

  export type CapabilityNeedProposal = {
    axis: "capability-need";
    proposalKey: string;         // e.g., "capability-need:external-catalog-scout:model"
    agentId: string;             // always "external-catalog-scout" for this slice
    kind: "skill" | "context" | "model" | "tool";
    summary: string;             // one-sentence description, ≤ 280 chars
    confidence: ProposalConfidence;
    evidenceTaskRunIds: string[];
  };
  ```

- [ ] Add a Zod schema for `ProceduralizationProposal` and validate at module boundaries (miner output, emitter input). This catches drift between the three modules early.

## Task 2: Industry-mapping miner

- [ ] Write failing tests with fixture evidence rows showing reviewer disagreements with `INDUSTRY_TO_VALUE_STREAM`.
- [ ] Implement `mineIndustryMappingProposals(deps: { db, thresholds }): Promise<IndustryMappingProposal[]>`:
  1. Query `BacklogItemActivity` where `kind = "evidence" AND payload.ambiguityReview IS NOT NULL AND payload.ambiguityReview.valueStream IS NOT NULL`.
  2. Group by the deterministic input `(industry-from-source-url-or-tags)`.
  3. For each group: count how often the reviewer's `valueStream` agrees vs. disagrees with what `INDUSTRY_TO_VALUE_STREAM` would have produced.
  4. Emit a proposal only when **disagreements** dominate (`agreementFraction ≥ minAgreementFraction` against the *reviewer's* value stream, not the deterministic one) AND `sampleSize ≥ minSampleSize`.
  5. Set `currentDeterministicMapping` from the constant (or `null` if the industry isn't keyed). The proposal body lets a human compare the reviewer's recommendation against the current mapping.
- [ ] Cover edge cases: industry not in the constant (proposal is "ADD this mapping" rather than "CHANGE"); reviewer values that aren't in the seeded value-stream list (drop, log nothing — that's a Slice 2 contract violation, not a Slice 3 concern).
- [ ] Run `pnpm --filter web exec vitest run lib/actions/hive-scout/proceduralization-miner.test.ts`.

## Task 3: Out-of-scope miner

- [ ] **Resolve the open question first** (see §Open Decisions #1): the `out_of_scope` and `duplicate_pattern` decisions don't persist as `BacklogItemActivity` rows under Slice 2 — they're only counted in the per-run summary. To mine them, this slice needs Slice 2's run summary to include a per-classification breakdown by `framework` and `industry` tag. This is a small Slice 2 amendment, not a re-design.
- [ ] If the open decision resolves "amend Slice 2 summary": add a `reviewClassificationByFramework` and `reviewClassificationByIndustry` map to `HiveScoutSummaryPayload` in `extractHiveScoutSummary` (Slice 2 surface), then write the failing tests for `mineOutOfScopeProposals`.
- [ ] If the open decision resolves "defer the axis": skip Task 3 entirely, mark this axis as deferred to Slice 3b, and proceed to Task 4. The plan still ships value via the industry-mapping and capability-need axes.
- [ ] Implement `mineOutOfScopeProposals(deps: { db, thresholds }): Promise<OutOfScopeProposal[]>` if the axis is in scope:
  1. Aggregate `reviewClassificationByFramework` / `reviewClassificationByIndustry` across the last N runs (default N=20, tunable).
  2. For each `(matcher, decisionCounts)` pair: emit a proposal only when `out_of_scope` decisions dominate by `≥ minAgreementFraction` and `sampleSize ≥ minSampleSize`.
  3. The proposal body says: "Adding this matcher to the deterministic pre-filter would have skipped K reviews in the last N runs (estimated cost saving: $X)." Cost is computed from `reviewLatencyMs` aggregates as a rough proxy.
- [ ] Tests: a single dominant out-of-scope class against a non-dominant one; thresholds gating; idempotent proposalKey.

## Task 4: Capability-need miner

- [ ] Write failing tests with fixture evidence rows where the reviewer's `rationale` repeatedly cites a missing capability.
- [ ] Implement `mineCapabilityNeedProposals(deps: { db, thresholds }): Promise<CapabilityNeedProposal[]>`:
  1. Query the same evidence rows; extract `rationale` strings.
  2. Apply a deterministic keyword/phrase classifier (no LLM): patterns like "needs model", "lacks context", "no skill for", "would benefit from" → mapped to a `kind`.
  3. Group by `(agentId, kind)` and count.
  4. Emit a proposal only when the count crosses `minSampleSize` and the keyword pattern is consistent across the rationale set.
  5. Before emitting, query existing `CoworkerCapabilityNeed` rows for `(agentId, kind, status IN ("submitted", "acknowledged"))` — if one already exists, *don't* emit a duplicate; instead, attach the new evidence to the existing need (via the emitter, Task 5).
- [ ] Edge cases: rationale field is missing or short (< 20 chars) → skip; classifier matches multiple kinds for one rationale → pick the highest-precision pattern, don't emit twice.
- [ ] Tests: confidence threshold gating; existing-need dedupe; multi-kind rationale handling.

## Task 5: Proposal emitter

- [ ] Write failing tests for `emitProposals(proposals: ProceduralizationProposal[], deps: { tx, now }): Promise<EmissionResult>`.
- [ ] Implement the emitter:
  1. For each proposal, look up an existing open `BacklogItem` with the same `proposalKey` (encoded in `BacklogItem.metadata.proposalKey` or in a structured part of the title).
  2. If none exists: create a new `BacklogItem` with `source: "hive-scout-proceduralization"`, `status: "deferred"`, `type: "platform"`, title = human-readable (e.g., `"Promote industry mapping: devops → Operate (98% reviewer agreement, n=42)"`), body = structured Markdown describing the evidence and the suggested code change, metadata = `{ proposalKey, axis, confidence, evidenceTaskRunIds }`.
  3. If one exists: update the body and metadata in place (carry the latest evidence), do NOT re-create.
  4. For `capability-need` proposals: also create a `CoworkerCapabilityNeed` row linked to the new `BacklogItem` via `linkedBacklogItemId` (the schema already supports this).
  5. Wrap all writes in a single transaction so a partial run never leaves orphaned proposals.
- [ ] Return `EmissionResult` with counters: `created`, `updated`, `skippedDuplicate` (open need already existed for capability-need axis), `total`.
- [ ] Tests: idempotent under repeated calls (no `created` increment on second run); body update on changing evidence; capability-need dedupe.

## Task 6: Wire into the prefilter seam

- [ ] Modify `runHiveScoutIngest` to accept an optional `proceduralPrefilter`. Default no-op preserves Slice 2 behavior. Add `skippedByPrefilter` to `IngestResult` and to `HiveScoutSummaryPayload`.
- [ ] Add tests: default no-op path doesn't change Slice 2 acceptance; injected prefilter that returns `{skip:true,reason}` for a fixture entry skips both review and backlog write and increments `skippedByPrefilter`.
- [ ] Build a default `loadApprovedPrefilters(deps: { db }): Promise<ProceduralPrefilter>` that reads approved out-of-scope proposals (status `accepted` AND backlog item closed with the right resolution) and assembles a deterministic matcher. Wire this into the production tool path so accepted proposals take effect on the next ingest run, no deploy.
- [ ] Tests: an approved out-of-scope proposal for `framework=research-only` causes the next ingest to skip matching entries before review.

## Task 7: Compose into the runner

- [ ] Implement `runProceduralizationMining(deps: { db, thresholds, now }): Promise<ProceduralizationRunResult>`:
  1. Load thresholds from `PlatformConfig` (`hive-scout.proceduralization.minSampleSize` default 5, `hive-scout.proceduralization.minAgreementFraction` default 0.8, `hive-scout.proceduralization.windowDays` default 30).
  2. Run all three miners in parallel.
  3. Pass the combined proposals to the emitter inside a single transaction.
  4. Return a `ProceduralizationRunResult` with per-axis counts and the `EmissionResult`.
- [ ] Tests: end-to-end with seeded evidence; PlatformConfig threshold respected; idempotent across repeated runs.

## Task 8: Schedule and govern

- [ ] Seed `hive-scout-proceduralization-mining` as a second scheduled task on the same `external-catalog-scout` agent. Daily cadence, `active: true`, owned by the install's primary admin user (matches the ingest task pattern).
- [ ] Add the governed `run_hive_scout_proceduralization_mining` MCP tool. Returns the `ProceduralizationRunResult` for operator visibility.
- [ ] Tests: tool fixture; seed-test asserts both tasks ship.

## Task 9: Verification gates

- [ ] Re-run affected unit tests:

```powershell
pnpm --filter web exec vitest run lib/actions/hive-scout/ lib/mcp-tools.test.ts packages/db/src/seed-hive-scout.test.ts
```

- [ ] Run the typecheck gate: `pnpm --filter web typecheck`.
- [ ] Run the canonical production build per [`AGENTS.md`](../../../AGENTS.md) §5: `pnpm --filter web build`. Zero errors required.
- [ ] **No migration was added.** State this explicitly in the PR description per the AGENTS.md §5 migration check.
- [ ] **UX verification:** with the platform running, manually trigger `run_hive_scout_proceduralization_mining` via the MCP tool surface. Confirm that:
  1. Proposals appear as `BacklogItem` rows with `source: "hive-scout-proceduralization"`.
  2. The AI Operations Map projects them through the existing generic backlog-evidence projection (no new UI work expected).
  3. Re-running the tool does not duplicate proposals.
  4. Approving an out-of-scope proposal (status transition + acknowledgement gesture) takes effect on the next `run_hive_scout_ingest` invocation — entries matching the approved matcher are skipped before review.

## Open Decisions (resolve before sign-off)

1. **Out-of-scope mining without per-decision evidence rows.** Slice 2 doesn't persist `out_of_scope`/`duplicate_pattern` decisions as `BacklogItemActivity` rows — they're only counted in the per-run summary. **Options:** (a) amend Slice 2's summary payload to include `reviewClassificationByFramework`/`reviewClassificationByIndustry` aggregates so Task 3 has data to mine — small surface, additive; (b) start persisting individual skipped decisions as a new evidence kind (`kind = "evidence-skipped-by-review"`) — larger surface, more complete; (c) defer the out-of-scope axis to Slice 3b until enough operator demand justifies the mining cost. **Recommendation:** option (a) — amend the summary, lowest cost, sufficient signal density for the proposal threshold.
2. **Proposal-key encoding location.** Should `proposalKey` live in `BacklogItem.metadata` (free-form JSON) or in a structured part of `BacklogItem.title` so it survives manual title edits? **Recommendation:** `metadata.proposalKey`. Operators editing titles is fine; the dedupe key shouldn't break when they do.
3. **Capability-need rationale classifier maintenance.** The keyword/phrase classifier in Task 4 is deterministic but English-specific. Will operators in non-English installs need their own classifier set? **Recommendation:** ship English-only for this slice, accept English-only as a known limitation in the spec, defer multilingual to Slice 3c if real demand emerges.
4. **Approved-proposal lifecycle.** When a human "approves" an industry-mapping proposal, what's the actual code path? Options: (a) operator manually edits `INDUSTRY_TO_VALUE_STREAM` and merges a PR (manual, but matches the deterministic-core invariant); (b) operator marks the backlog item as `accepted` and a follow-up automated step writes the mapping into a `PlatformConfig` lookup that overrides the constant at runtime (faster, but introduces a new override mechanism). **Recommendation:** option (a) for this slice — keep deterministic code in code. Revisit (b) only if operator load justifies it.
5. **Proceduralization-candidate / capacity-continuity overlap.** Slice 3 proposals could become `CapacityContinuityCandidate` rows (the `proceduralization-candidate` source kind already exists at [`candidates.ts:16`](apps/web/lib/capacity-continuity/candidates.ts:16)). Should the emitter also write those, or is the backlog-item path sufficient? **Recommendation:** ship backlog-item-only for this slice; observe whether operators actually want auto-scheduling of accepted proposals before adding capacity-continuity emission.

## Acceptance

Functional:

- Mining runs against persisted evidence and emits typed `ProceduralizationProposal` objects.
- Proposals are written as `BacklogItem` rows with `source: "hive-scout-proceduralization"`, idempotent on `proposalKey`.
- Industry-mapping proposals correctly identify reviewer-vs-deterministic disagreements above threshold.
- Capability-need proposals correctly dedupe against existing open `CoworkerCapabilityNeed` rows.
- Out-of-scope proposals correctly aggregate from Slice 2 summary breakdown (assuming Open Decision #1 resolves to option (a)).
- Approved out-of-scope proposals take effect on the next ingest run via the prefilter hook.
- Re-running the miner does not duplicate proposals.

Safety:

- Mining never modifies `BacklogItemActivity` rows written by Slice 2.
- Mining never writes to `INDUSTRY_TO_VALUE_STREAM`, `PlatformConfig`, or any code constant.
- Mining never calls the LLM provider; the miner is pure SQL/Prisma.
- Every promotion is human-gated through the backlog-item approval flow.
- Confidence thresholds gate every proposal; misconfiguring `minSampleSize` to `0` is rejected at config load time (validation step).
- The prefilter hook defaults to no-op; Slice 2's deterministic-only path is unchanged unless an operator approves a proposal.
- No new DB tables, no new migrations, no new identity entities.

Build gate (per [`AGENTS.md`](../../../AGENTS.md) §5):

- Unit tests pass for affected files.
- `pnpm --filter web build` passes with zero errors.
- UX path exercised against the running platform — not just unit tests.
- Spec §7 Slice 3 acceptance ("repeated false positives decline run-over-run", "repeated out-of-scope classes become deterministic filters", "repeated 'existing skill gap' outcomes against the same coworker become rules") is observed in a real install over at least 5 ingest cycles before the slice is considered shipped end-to-end.

## Branch & commit discipline (per [`AGENTS.md`](../../../AGENTS.md) §4)

- [ ] Implementation branch: `feat/hive-scout-v3` off fresh `origin/main`.
- [ ] Every commit signed: `git commit -s` (DCO bot blocks merge otherwise).
- [ ] Push after every commit; local-only commits are invisible to CI.
- [ ] Sweep for cross-PR overlap before opening: `gh pr list --state open --search "hive-scout in:title,body"` and `git log --oneline origin/main..HEAD -- apps/web/lib/actions/hive-scout`.
- [ ] Squash-and-delete on merge: `gh pr merge <n> --squash --delete-branch`.

## Sequencing context

After Slice 3 lands, Slice 4 (burn-rate-aware scheduling) is the natural next chunk per spec §10. The two are mutually unblocking — Slice 3 produces proposals that Slice 4 could schedule under lagging-quota windows, and Slice 4's queue class is the natural place to run the miner cheaply. Either can ship first.
