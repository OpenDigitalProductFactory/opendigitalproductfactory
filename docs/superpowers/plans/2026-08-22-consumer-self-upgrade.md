---
status: active
---

# Consumer release-artifact self-upgrade plan

**Backlog item:** BI-89887875  
**Design:** `docs/superpowers/specs/2026-08-22-consumer-self-upgrade-design.md`  
**Decision:** DI-2AB64991D7A4 (`artifact-native`, high confidence)  
**Branch:** `fix/consumer-self-upgrade`

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

A source-free consumer install discovers a verified immutable release, reaches governed preflight without executing Git, promotes the tagged release images through its recorded Compose topology, and atomically persists the matching release assets and installer identity. Contributor source upgrades remain unchanged.

## Backlog coverage

- Parent: BI-89887875
- Decision: atomic
- Rationale: target resolution, candidate verification, release-mode promotion, and installer-state convergence are one safety invariant. Shipping any subset either remains unreachable, selects an unverifiable artifact, or permits a successful swap to revert on the next restart. No phase is independently useful or safe to release.
- Dependencies: none
- Receipt: pending immutable-plan coverage write
- Governed-process blocker if the live writer cannot record the atomic decision: BI-MCP-EFF-3E441834

## Phase 1 — Installation contract and target resolver

**Deliverable:** consumer/customer installs select `release` from installer state (or the compatibility marker), reject incomplete state before mutation, and resolve the newest verified release without Git.

**Files:**

- `install-dpf.ps1`
- `scripts/installer/lib/state.ps1`
- `scripts/lib/lifecycle-capability-profile-contract.test.mjs`
- `apps/web/lib/self-upgrade/config.ts`
- `apps/web/lib/self-upgrade/config.test.ts`
- `apps/web/lib/release-health/release-runs-reader.ts`
- `apps/web/lib/release-health/release-runs-reader.test.ts`
- `apps/web/lib/self-upgrade/release-target.ts`
- `apps/web/lib/self-upgrade/release-target.test.ts`
- `apps/web/lib/self-upgrade/version.ts`
- `apps/web/lib/self-upgrade/version.test.ts`

**TDD sequence:**

1. Add failing Windows consumer state assertions for install path, mode, compose chain, image tag, and last-successful installer version.
2. Add failing config tests proving a release-assets-only fixture selects release mode and stale consumer state is explicitly unready.
3. Add failing target tests for verified/newer, verified/current, absent, in-progress, failed, and malformed releases.
4. Implement the smallest state convergence and resolver functions; refactor multi-key state updates into one atomic helper.
5. Run the focused installer, config, release-health, release-target, and version suites.

## Phase 2 — Artifact-native preflight and promoter carrier

**Deliverable:** release mode resolves the tagged candidate promoter to a validated digest, pulls candidate images/assets, and uses the existing readiness and quiescence gates without a source build.

**Files:**

- `apps/web/lib/self-upgrade/promoter-artifact.ts`
- `apps/web/lib/self-upgrade/promoter-artifact.test.ts`
- `apps/web/lib/self-upgrade/preflight.ts`
- `apps/web/lib/self-upgrade/preflight.test.ts`
- `apps/web/lib/self-upgrade/promoter.ts`
- `apps/web/lib/self-upgrade/promoter.test.ts`
- `Dockerfile.promoter`
- `scripts/promote.sh`
- `apps/web/lib/self-upgrade/promote-script-functional.test.ts`

**TDD sequence:**

1. Add failing candidate-reference tests proving a release tag is pulled and pinned while the OCI revision must equal the target SHA.
2. Add failing promoter-command tests for the release flag, tag/owner environment, and narrowly scoped writable install mount.
3. Add failing functional shell tests proving release mode pulls rather than builds and fails before swap on identity mismatch.
4. Implement the candidate-reference, command, readiness, and shell branches while retaining shared migration/health/content verification.
5. Run promoter artifact, preflight, command, functional script, and existing rollback tests.

## Phase 3 — Transactional release identity and orchestration

**Deliverable:** the orchestrator routes consumers through the release path, and a successful verified swap atomically installs candidate release assets plus the durable image identity.

**Files:**

- `apps/web/lib/queue/functions/self-upgrade.ts`
- `apps/web/lib/queue/functions/self-upgrade.test.ts`
- `scripts/installer/install-release-assets.mjs`
- `scripts/installer/install-release-assets.test.mjs`
- `scripts/promote.sh`
- `apps/web/lib/actions/self-upgrade.ts`
- `apps/web/lib/actions/self-upgrade.test.ts`

**TDD sequence:**

1. Add a failing non-Git consumer orchestration test asserting Git/source preparation are never called and candidate preflight is reached.
2. Add failing asset-transaction tests for manifest validation, unlisted/path-traversal rejection, obsolete managed-file removal, operator `.env` preservation, and injected rollback.
3. Wire release resolution, candidate reference, common lifecycle gates, release promotion parameters, and truthful skip reasons.
4. Refactor shared target/run-plan data so source and release strategies converge before quiescence rather than duplicating the lifecycle.
5. Run the full self-upgrade, actions, release-health, installer, and promoter suites.

## Phase 4 — Completion gate and live handoff

**Deliverable:** the exact tree is reviewable, policy-clean, and functionally proven to the maximum reachable boundary before publication.

**Verification:**

1. `node scripts/check-style-drift.mjs` (impact-contract obligation).
2. Focused Vitest/Node/PowerShell suites from Phases 1–3, with the worktree root and test counts confirmed.
3. `pnpm --filter web typecheck` and applicable package typechecks.
4. `pnpm run pregate:preflight`.
5. Exact-tree local merge CI through `pnpm run pregate` and fresh semantic review.
6. Open a signed DCO PR, run `pnpm pr:ready`, then `pnpm pr:health` through merge-queue completion.
7. Publish/install the first release containing the repair through the governed release path. Run `pnpm verify:preflight` against that feature SHA and confirm the canonical consumer install no longer logs Git target resolution. A later verified release (new source SHA) is required for a literal live self-swap; until then the release-mode functional harness is the executable promotion proof.

## Risks and rollback

- **Wrong artifact lineage:** fail before quiescence unless the candidate image labels and promoter contract match the verified release SHA.
- **Mutable tag drift:** discover by release tag but execute the promoter by digest; verify pulled service revisions before swap.
- **Compose-topology loss:** accept only the ordered chain recorded in install-state; never invent a platform overlay.
- **Identity reverts after restart:** commit assets, `.env`, and install-state as one post-verification transaction.
- **Managed-file overwrite:** only files listed by verified old/new manifests are replaced or removed; operator-owned files and `.env` lines are preserved.
- **Source-upgrade regression:** release behavior is a separate derived strategy; existing upstream/local tests are mandatory.
- **Failed post-swap identity commit:** restore managed files, env bytes, and state from the transaction recovery directory and surface a failed run for reconciliation.

## Definition of done

- Every BI acceptance criterion is covered by an executable test.
- The non-Git consumer regression reaches preflight without any Git invocation.
- A functional promoter test exercises pull, migration, swap, identity verification, and durable release identity.
- Existing contributor upgrade tests and exact-tree gates pass.
- The PR is merged and the canonical install is bootstrapped onto a release that contains the repair.
