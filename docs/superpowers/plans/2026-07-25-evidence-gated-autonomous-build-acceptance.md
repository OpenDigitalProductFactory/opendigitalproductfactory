# Evidence-Gated Autonomous Build Acceptance

**Status:** implemented, default-OFF (awaiting operator ratification to enable)
**Kernel decision:** DI-53037C92BC0A (`evidence-auto-accept`, composite 13.48 vs `human-only` 11.75 vs `blind-auto-accept` 0.80; margin 1.73; HIGH confidence; no commandment conflict)
**Backlog:** unblocks the governed-autopilot drain of the ~570 acceptance-gated feature backlog items.

## Problem

An unattended governed-autopilot **feature** build cannot reach `complete` on its own. It deterministically stalls at the `review→ship` phase gate, whose `acceptance-evaluated` + `acceptance-all-met-if-array` requirements read `FeatureBuild.acceptanceMet`. That column had exactly one writer in the codebase — the human **"Record Acceptance"** UI action (`recordBuildAcceptance` → `BuildStudioWorkflowActionCard.tsx`). Nothing autonomous ever wrote it, so every feature build aged out to `abandoned` after 7 days. **Result: zero Build Studio completions in 33 days** (the last 7 completions were June interactive sessions or acceptance-exempt kinds — `doc`/`chore·minimal`/`fix·merged`).

This is a governance gate, not a bug: the acceptance write itself is sound. The question was whether the autopilot may satisfy that gate autonomously.

## Decision (WWMD / kernel)

`principle_decide` scored three architecturally-distinct options. `evidence-auto-accept` won decisively and with no commandment conflict. The deciding commandments were **Ship Real Functionality** and **Do the work; don't task the operator with what an agent can do** — the latter scored *negative* for `human-only`, i.e. forcing a human to click-accept 570 builds is itself a governance violation. `blind-auto-accept` was buried (0.80) by governance/blast-radius.

## Design

Four changes, all behind a **default-OFF** flag so the code merges inert:

1. **`apps/web/lib/build/auto-accept.ts`** (new, plain module — not `"use server"`):
   - `buildAcceptanceEvidenceRecord(criteria, evidenceText)` — pure builder for the `acceptanceMet` array.
   - `writeAcceptanceMet({...})` — the single shared acceptance write (append-only `BuildArtifactRevision` + `FeatureBuild.acceptanceMet` column via `saveBuildArtifactRevision`, plus an audit `BuildActivity` row). `activityTool` distinguishes machine (`auto_record_acceptance`) from human (`record_acceptance`).
   - `autoAcceptBuildOnEvidence(buildId)` — the evidence-gated path. Never throws (fail-closed).
2. **`apps/web/lib/integrate/build-studio-config.ts`** — `isEvidenceAutoAcceptEnabled()` via the existing `resolveActivationFlag(env, PlatformConfig, defaultOn=false)` pattern. Default **OFF**; enable live (no restart) via the `BUILD_EVIDENCE_AUTO_ACCEPT` PlatformConfig row, or `DPF_BUILD_EVIDENCE_AUTO_ACCEPT=1`.
3. **`apps/web/lib/integrate/ship-on-review-approval.ts`** — call `autoAcceptBuildOnEvidence` at the top of `advanceReviewedBuildToShip`, the single autonomous choke point every advance route funnels through (fresh UX pass, UX-skipped, diff-re-entry, and the reconciler re-drive of the already-stranded backlog). Wrapped so it never blocks the ship path.
4. **`apps/web/lib/actions/build.ts`** — `recordBuildAcceptance` (the human path) now delegates its write to the shared `writeAcceptanceMet` (Single Source of Truth). No behavior change for the human path.

### The evidence gate — auto-accept fires ONLY when ALL hold

1. `isEvidenceAutoAcceptEnabled()` is true (default OFF).
2. `build.phase === "review"`.
3. The build's `review→ship` policy actually requires acceptance (`getProcessPolicy(kind, size).gates["review->ship"]` includes `acceptance-evaluated`) — exempt kinds (doc/fix·minimal/chore·minimal) are a no-op.
4. `acceptanceMet` is not already set (idempotent — never overwrites a human or prior auto acceptance).
5. `verificationOut.typecheckPassed === true`.
6. `uxVerificationStatus ∈ {complete, skipped}` (never failed/running/unknown) — a build-specific guard.
7. Acceptance criteria present (`brief.acceptanceCriteria` else `designDoc.acceptanceCriteria`).

**Tests are advisory, NOT gated.** `verificationOut.testsFailed` is the whole apps/web suite (repo-wide, including pre-existing failures unrelated to this build — builds have completed at `testsFailed=88`), so gating on `=== 0` would couple a build's acceptance to unrelated repo test health and almost never fire. This mirrors the operator's 2026-06-07 policy: typecheck (build-relevant) hard-blocks; tests/UX advisory. The test counts are recorded in the acceptance evidence for legibility. A future refinement should gate on the build's SCOPED test delta once separable from the repo-wide suite.

The evidence is embedded per-criterion (`evidence` field) and in a distinct `auto_record_acceptance` audit row, so the audit trail shows machine-vs-human and the exact gate that passed.

## Rollout / ratification

The code ships **inert**. To activate (operator ratification):

1. Deploy this PR (platform self-upgrade).
2. Set the `BUILD_EVIDENCE_AUTO_ACCEPT` PlatformConfig row to `true` (live, no restart). The reconciler then re-drives the stranded backlog through the evidence gate.
3. To carry review→ship all the way to `complete`, also enable `DPF_AUTO_COMPLETE_VERIFIED_BUILDS` (governs ship→complete). On this fully-local (private/fork_only) install, "complete" registers a local ProductVersion delivery — the code is **not** auto-PR'd/merged/deployed; pushing to GitHub remains a human gate.

## Risks & residual gaps

- **Ownership bypass (intended):** the autonomous path drops the `createdById === userId` session check that `recordBuildAcceptance` enforces. Safe: it is not a session action; the evidence gate is the real guard; the audit actor is the real build owner (`createdById`), not a sentinel.
- **Concurrency:** two reconcilers could both attempt a write → a duplicate append-only revision or a rare unique-constraint conflict. Mitigated by fail-closed try/catch, the idempotency check, and the phase-guarded `updateMany` in `advanceReviewedBuildToShip` that lets only one advance win.
- **Zero-criteria builds (residual):** a feature/chore·standard build with an empty `acceptanceCriteria` still cannot satisfy `acceptance-evaluated` — auto-accept correctly no-ops (never fabricate criteria) and the build stays stranded. Those need criteria authored at ideate; tracked separately.
- **Not addressed here:** shared-sandbox contention at the verification step (worktree-isolation gap) and provider-limit failover (BI-0224C450) are distinct blockers on the same drain.

## Tests

`apps/web/lib/build/auto-accept.test.ts` covers: accepts on all-green (feature, UX complete/skipped, designDoc fallback) and despite repo-wide `testsFailed>0`/`null` (tests advisory); declines on flag-off, dirty typecheck, UX failed/running/null, missing criteria, already-accepted, non-review phase, and acceptance-exempt kind; and never throws when the DB read rejects. The human path (`build-governed.test.ts`) continues to pass through the shared write.
