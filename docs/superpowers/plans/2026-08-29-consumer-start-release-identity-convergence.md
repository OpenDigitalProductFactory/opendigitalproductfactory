---
status: active
---

# Consumer start-path release identity convergence implementation plan

**Backlog item:** BI-6CB35411  
**Workroom:** WC-DD034A30  
**Design:** `docs/superpowers/specs/2026-08-29-consumer-start-release-identity-convergence-design.md`

## Delivery shape

Deliver one atomic release-identity contract: a promoter must commit verified
release identity to the canonical install root, and the Windows start path must
project that recorded identity into Compose. Shipping only one half leaves a
silent downgrade path, so the changes and rollback evidence remain one PR.

## Backlog coverage

- Decision: atomic
- Parent: `BI-6CB35411`
- Receipt: pending
- Rationale: Canonical-root promotion and state-authoritative restart projection close one release-identity invariant; either half alone leaves a consumer install able to restart onto different bytes.
- Dependencies: protected BI-3FD07259 caller bridge PR #4840 at `7eba6d0c2485a800f8d66f31aa1521008fa9e59b`; no independent BI decomposition.
- Consumer start release-identity convergence -> `BI-6CB35411`

| Deliverable | Backlog item | Requirements | Contracts | Flows | Verification | Depends on |
| --- | --- | --- | --- | --- | --- | --- |
| Consumer start release-identity convergence | `BI-6CB35411` | `OBJ-CSRI-001`, `OBJ-CSRI-002`, `OBJ-CSRI-003`, `OBJ-CSRI-004`, `OBJ-CSRI-005` | `AC-CSRI-001`, `AC-CSRI-002`, `AC-CSRI-003`, `AC-CSRI-004`, `AC-CSRI-005` | Phase 1, Phase 2, Phase 3, Phase 4, Phase 5 | `AC-CSRI-001`, `AC-CSRI-002`, `AC-CSRI-003`, `AC-CSRI-004`, `AC-CSRI-005` | `BI-3FD07259` |

## Phase 1 — Lock the source/canonical-root vocabulary

1. Extend `apps/web/lib/self-upgrade/promoter.test.ts` with RED command-builder
   cases for a source workspace distinct from the canonical install root,
   same-path aliasing, invalid/relative canonical paths, and readiness mode.
2. Add `canonicalInstallPath` to `PromoterParams`; centralize host-path
   validation and fixed mount selection in `promoter.ts` instead of adding
   another inline Docker-argument branch.
3. Mount a distinct canonical root read-write at `/canonical-install`, expose a
   fixed `PROMOTE_INSTALL_ROOT`, and retain `/host-source` as the source carrier.
4. Coordinate the one call-site addition in
   `apps/web/lib/queue/functions/self-upgrade.ts` after BI-3FD07259 merges; do not
   modify its admission/dispatch state machine or co-claim that file earlier.

## Phase 2 — Make the release transaction target canonical

1. Extend `scripts/installer/install-release-assets.test.mjs` with a RED fixture
   whose staged source and install root are different directories.
2. Extend `scripts/promote-install-state-rollback.test.mjs` and the focused
   promoter functional tests to require canonical-root `.env`, release marker,
   managed assets, install-state convergence, and exact rollback on injected
   failure.
3. Update `scripts/promote.sh` so release-identity commit invokes
   `scripts/installer/install-release-assets.mjs` against
   `PROMOTE_INSTALL_ROOT`, while source/build/backup operations continue using
   `PROMOTE_SOURCE`.
4. Keep `install-release-assets.mjs` as the sole atomic transaction owner;
   refactor only shared path/tag validation and snapshot bookkeeping needed to
   make the two roots explicit.

## Phase 3 — Project install-state identity at Windows start

1. Add RED cases to `scripts/lib/lifecycle-capability-profile-contract.test.mjs`
   (and a focused PowerShell contract fixture if separation improves clarity)
   for recorded-tag precedence over root `latest`, missing/malformed consumer
   identity, disagreement diagnostics, and unchanged contributor behavior.
2. Add a small pure helper in `scripts/installer/lib/state.ps1` that validates
   and resolves the consumer release tag from canonical install-state.
3. Invoke it in both `dpf-start.ps1` and `scripts/dpf-start.ps1` before Compose
   arguments are resolved; set the process `DPF_IMAGE_TAG` only from a valid
   consumer state and fail before Docker mutation otherwise.
4. Keep legacy/source compatibility explicit; never infer that a known consumer
   may fall back to mutable `latest`.

## Phase 4 — Blast radius and refactor budget

1. Audit every `runPromoter` caller and release-mode fixture; non-release runtime
   transitions must retain read-only source mounts and unchanged behavior.
2. Audit installer schema/migration behavior for legacy states and avoid a
   schema change unless the existing `imageTag`/`installMode` contract proves
   insufficient.
3. Spend roughly one fifth of implementation effort consolidating repeated
   release-tag validation, source-carrier/canonical-root naming, and Docker mount
   construction. Do not broaden into admission, dispatch, publication, or UI.
4. Run architecture and blast-radius review against the exact committed diff and
   fold only concrete findings back into the implementation.

## Phase 5 — Functional verification and protected delivery

1. Run the focused promoter, installer transaction, rollback, lifecycle, and
   public version-route suites plus web typecheck and all source-policy guards.
2. Freeze a DCO-signed candidate, obtain one fresh semantic review, and run the
   governed exact-tree local CI gate when capacity is available. Any authorized
   infrastructure bypass is ledgered as non-PASS; protected GitHub checks remain
   mandatory.
3. Open one non-draft DCO PR, clear review findings, and enter the protected
   merge queue.
4. Publish one canonical immutable release and coordinate one governed live
   upgrade only after BI-3FD admission/dispatch is live and the release identity
   is unambiguous.
5. Verify an ordinary `dpf-start.ps1 -NoBrowser` restart preserves the same
   immutable tag, served SHA, health, Workrooms/backlog data, and
   `/api/platform/version` plus `/api/platform/image-version` projection.

## Verification commands

```powershell
pnpm --filter web exec vitest run lib/self-upgrade/promoter.test.ts lib/queue/functions/self-upgrade.test.ts
node --test scripts/installer/install-release-assets.test.mjs scripts/promote-install-state-rollback.test.mjs scripts/lib/lifecycle-capability-profile-contract.test.mjs
pnpm --filter web typecheck
pnpm run pregate:preflight
pnpm run pregate
```

The final two commands remain governed gates. No command in this plan edits the
installed runtime source under `D:\DPF`.
