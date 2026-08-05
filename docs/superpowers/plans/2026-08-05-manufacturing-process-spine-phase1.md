# Manufacturing Process Spine — Phase 1 (Reliability) implementation plan

- **Date:** 2026-08-05
- **Status:** Draft
- **Epic:** EP-PROCESS-SPINE
- **Spec:** docs/superpowers/specs/2026-08-05-manufacturing-process-spine-design.md
- **Capsule:** WC-3B8A9E08 (external Claude executor)
- **Covers:** WS1 (BI-9FD287EC — provable spine), WS3 (BI-FEE737CD — sandbox/worktree reliability)
- **Executor note:** written in a SOURCE-ONLY worktree; every task below carries its own test and MUST be implemented + verified in a compile-ready session (`node scripts/lib/bootstrap-worktree-deps.mjs`).

Phase 1 is the precondition for Phase 2 (observability) and Phase 3 (enforcement): you cannot enforce a process built on flaky tools, nor measure what you cannot observe.

## Grounding — the real seams (and two corrections a naïve plan would get wrong)

**WS1 anchor:** `packages/dpf-skill-pack/hooks/process-spine-health-check.mjs` (+ `.test.mjs`), contract `packages/dpf-skill-pack/process-spine-replacements.json`, Grok wiring `grok-session-start.mjs` + `grok-skill-exposure-adapter.mjs`.

- **Correction 1 — "make UNKNOWN verified" is blocked by a real platform limit.** The hook *deliberately* separates `installed-on-disk` from `exposed-in-session` and reports `UNKNOWN` for the latter, because only Grok has a non-interactive skill-list API (`grok plugin list --json`). Claude/Codex/Antigravity have none; the authors explicitly rejected feeding a proxy because it would produce *false* "verified" — "worse than the honest unknown." **So WS1 must not fabricate client introspection.** It proves the spine loaded **behaviorally** — a receipt the loaded spine emits — which is exactly AGENTS.md §12 ("governance approves evidence, not provenance"). Exposure stays honestly `unknown` at session start; the *proof* moves to evidence the agent produces.

**WS3 anchors:** `scripts/lib/bootstrap-worktree-deps.mjs` (BI-3047C122 / EP-WORKTREE-HYGIENE), lease seam `packages/dpf-skill-pack/hooks/lease-guard.mjs` + `scripts/gate-worktree.mjs`, session-start seam `grok-session-start.mjs`.

- **Correction 2 — "auto-run bootstrap in the create hook" was already rejected.** The bootstrap is *intentionally* NOT run inside the blocking `WorktreeCreate` hook: "a multi-minute install must never gate worktree creation." It is idempotent, fail-safe, managed (pinned pnpm via the content store), never junctions, never mutates the root clone. **So WS3 must default convergence as a NON-BLOCKING background step after creation** (or a fast opt-in), never as a blocking gate — honoring the existing design decision. `classifyReadiness()` (compile-ready vs source-only, where emptiness — not existence — is the signal) is the readiness oracle to reuse.

## WS1 — Provable spine-load (BI-9FD287EC)

Enforcement contract is already resolved by WWMD (DI-F32A8BC90372): **hard-refuse where hooks + exposure exist (Grok); record + loud-flag + block-at-PR on hookless hosts.**

- **Task 1.1 — Spine-proof receipt contract (TDD).** Add a behavioral-proof channel distinct from exposure: `assessProcessSpine()` gains a `proof` input (a signed receipt that the required spine skills were actually invoked this capsule, or an explicit spine handshake at capsule claim). New severity `requires-proof` when neither exposure is `verified` nor a proof is present. Test: unknown-exposure + no-proof → `requires-proof`; unknown-exposure + valid-proof → `proven`; Grok verified-exposure → `ok` (unchanged). Extend `process-spine-health.test.mjs`.
- **Task 1.2 — Record the proof on the WorkCapsule (TDD + migration if needed).** Add `spineProofState` to the capsule coordination record (enum: `proven | requires-proof | verified-exposure`). The proof is written when the agent invokes a spine skill / performs the handshake. Reuse existing capsule-evidence plumbing (`record_capsule_evidence`) rather than a parallel store (SSOT).
- **Task 1.3 — Hard-refuse where hooks + exposure exist (TDD).** Extend the Grok/lease-guard PreToolUse pattern so a project-work tool is refused when `spineProofState=requires-proof` AND the host exposes verified skill state. Fail-open only where the host cannot support the check (per Correction 1). Mirror `lease-guard.mjs` structure.
- **Task 1.4 — Block-at-PR on hookless hosts (TDD contract test).** Wire the PR/evidence gate (`pnpm pr:health`) to require a non-`requires-proof` `spineProofState` on the capsule behind the PR. Add a release-gate contract test alongside `tests/release/*-contract.test.mjs`. This is the Option-B backstop.

## WS3 — Sandbox contention + pre-gateable worktrees (BI-FEE737CD)

- **Task 3.1 — Non-blocking default convergence (TDD).** After `WorktreeCreate`, kick `bootstrap-worktree-deps.mjs` as a detached/background convergence (never blocking creation — Correction 2), gated by an opt-in-default env/config. Reuse `classifyReadiness()`; surface the resulting state. Test the non-blocking invocation + idempotency + fail-safe (failure leaves source-only, never broken).
- **Task 3.2 — Auto-claim nonprod lease on session start (ADOPT `WC-009156D6`, TDD).** This work already exists as a stale-but-`working` capsule (`WC-009156D6` = FB-AD29AC0C) — **adopt/revive it, do not open a duplicate** (overlap surfaced by the 2026-08-05 sprawl triage below). Wire `claim_nonprod_environment_lease` into the session-start seam (`grok-session-start.mjs` and the Claude/Codex equivalents), fail-open so SessionStart never wedges. Removes the "churn waiting on shared sandbox" by making the lease automatic rather than a remembered manual step.
- **Task 3.3 — Readiness truth in session context (TDD).** Ensure the SessionStart "Worktree verification-readiness" block reflects post-bootstrap state so an agent never claims a gate it cannot run (source-only) nor misses one it can (compile-ready).

## Sandbox / WIP-sprawl triage findings (2026-08-05)

`promote_to_build_studio` refused Phase 1 with `wip_cap_reached` (15 FeatureBuilds vs limit 3). A `list_work_capsules` sweep found the problem is deeper than the build cap:

- **The WIP board misreports liveness.** ~100 capsules are `working` and 14 are `blocked`. Dozens of Build-Studio capsules share an identical `updatedAt` of exactly `…T14:00:00` on different dates — an automated daily heartbeat, not real progress. **`updatedAt` is therefore not a staleness signal.** Real liveness is `leaseExpiresAt` / `lastSyncedAt`, and those are overwhelmingly **expired** (external Codex capsules, oldest `2026-06-20`) or **null** (BS capsules never leased). Abandoned work is displayed as active — this is root-cause E (no observability) made physical, and the mechanism by which work gets silently duplicated.
- **Phase 1 overlaps existing stale capsules — adopt, don't duplicate.**
  - `WC-009156D6` "Auto-claim nonprod-environment-lease on session start" = **WS3 Task 3.2** (FB-AD29AC0C). Revive it.
  - `WC-D7D94315` "Right-sizing matrix Phase 2" = **WS6** (FB-3D0A5095). Phase-3 WS6 must resume this, not re-file.
  - Client-hook-plane bundle — `WC-714C72F8` (spec) + `WC-8F037325` (SessionStart) / `WC-A9FD57CA` (PreCompact) / `WC-1B017A29` (Stop) / `WC-76AED0BE` (PostToolUse) / `WC-4D6BD443`,`WC-43BAD97E` (PreToolUse) — **WS1's spine-proof hook must coordinate with this plane**, reusing its launcher (`WC-4BFA6CAA`) rather than adding a parallel hook path.

## WS9 — Reap stale WIP + fix the liveness signal (new, from triage)

- **Task 9.1 — Reap by lease, not by timestamp (recommend-not-auto).** Identify capsules whose `leaseExpiresAt` is past (or null + no open PR) and whose branch has no live PR; produce an abandon list for **explicit human go** (never auto-abandon — destructive-actions-require-explicit-go). Candidates: the 14 `blocked` codex capsules (leases expired days-to-weeks ago) and the null-lease BS capsules kept alive only by the 14:00 heartbeat.
- **Task 9.2 — Make the WIP board tell the truth (feeds WS4/WS5).** Derive capsule liveness from `leaseExpiresAt`/`lastSyncedAt`, not `updatedAt`; stop the daily heartbeat from masking abandonment. This is a down-payment on the Phase-2 conformance ledger.

## Backlog coverage

- **BI-9FD287EC (WS1)** → Tasks 1.1–1.4 (coordinates with the hook-plane bundle).
- **BI-FEE737CD (WS3)** → Tasks 3.1, 3.3 fresh; **Task 3.2 adopts `WC-009156D6`**.
- **WS9 (reap stale WIP + liveness fix)** → filed as a new BI under EP-PROCESS-SPINE (Task 9.1 recommend-not-auto; Task 9.2 feeds WS4/WS5).

## Verification (Phase-1 done criteria)

1. All new tests green in a compile-ready session (`vitest run` on affected files).
2. `pnpm --filter web build` clean.
3. Functional: a Claude/Codex session with the spine loaded produces a `proven` receipt; a session without it is `requires-proof` and is blocked at PR (not merely warned). A fresh worktree converges to compile-ready in the background without blocking creation, and auto-holds a lease.
4. Documentation impact: update `docs/architecture/skill-surfaces-runbook.md` (spine-proof contract) and the worktree runbook (default convergence).

## Sequencing

WS3 Task 3.1/3.2 first (unblocks local gating and removes sandbox churn — highest immediate relief), then WS1 1.1→1.2→1.3→1.4. WS1 hard-refuse (1.3) ships only after the proof channel (1.1/1.2) is reliable — never enforce before the mechanism is trustworthy.
