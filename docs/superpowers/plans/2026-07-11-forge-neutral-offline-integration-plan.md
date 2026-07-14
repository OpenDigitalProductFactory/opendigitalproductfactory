# Forge-Neutral, Offline-Capable Git Integration Plan

**Date:** 2026-07-11
**Status:** Ratified — Phase 1 implementation in progress
**Epic:** EP-5410E8EA
**Spec:** `docs/superpowers/specs/2026-07-11-forge-neutral-offline-integration-design.md`
**Kernel ledger:** DI-C6483F614871
**Boundary ledger:** DI-14811CE8E7ED

## Delivery rules

- One BI per branch/PR; every commit DCO-signed.
- Preserve GitHub behavior until shadow parity is proven.
- No phase changes the configured live remote as a side effect.
- Schema changes require schema audit, fleet-safe migration, and canonical migration verification.
- Runtime-bound evidence comes from the shared local-CI convergence sandbox or canonical install.
- Each phase records outage-path evidence, not only happy-path structural tests.
- Public-hive publication always re-evaluates live contribution policy at dispatch; queued intent is not durable consent.
- Local/own-repo refs may contain private bytes and are never mirrored wholesale to a public forge.

## Phase 0 — Ratify boundaries

Owner: operator + Enterprise Architect.

1. Decide whether local admission targets public `main` or an organization/install integration branch.
2. Decide bundled Forgejo versus adapter-only scope.
3. Decide signed bundle/release provenance authority.
4. Update the spec decision log; if options remain architecturally distinct, route each through `principle_decide`.

Status: partially ratified. `DI-14811CE8E7ED` selects the bundled bare local Git/ref-store core plus external forge adapters. Full Forgejo/Gitea remains optional deployment-profile scope, not default bundled architecture. Local-admission target and signed bundle/release provenance authority remain later-phase decisions before Phase 3/6 cutover work.

Exit: no unresolved boundary changes the authority model for the phase being implemented.

## Phase 1 — Forge contracts and GitHub parity

**BI-FC29F7AB — Define forge-neutral integration contracts and GitHub adapter** (`large`)

1. Inventory every GitHub-specific call site: repo parsing, branch/commit, PR, checks, reviews, issues, releases, OAuth, webhooks, and inventory sync.
2. Define capability-scoped contracts and normalized error/freshness types. Do not encode GitHub-only fields in the core model.
3. Move duplicated GitHub URL parsing and REST/GraphQL calls behind `GitHubForgeAdapter`.
4. Add adapter contract tests using recorded fixtures for success, timeout-after-success, rate limit, unauthorized, policy rejection, and non-fast-forward divergence.
5. Keep `gh`-based operator tools working through the GitHub adapter until replacement is proven.

Verification: targeted tests, web typecheck, production build, and before/after parity against a test PR. No remote change.

## Phase 2 — Local verification without publication

**BI-76551B2D — Decouple pre-push and local CI from remote branch publication** (`large`)

Status: implementation in progress. Landed slices make `pnpm run pregate`
record local evidence without publishing by default, retain push-before-lease
only as explicit `--push` transition/recovery mode, consume a locally available
accepted-base ref by default, record candidate/base/integration/tree SHA
metadata in gate evidence, and remove the pre-push docs-only bypass's hard
dependency on `origin/main` by allowing a configured local accepted-base ref.
The remaining work in this BI is stronger toolchain/expiry evidence and full
network-disconnect proof.

1. Change `scripts/gate-worktree.sh` so local verification defaults to `--no-push`; publication is a separate explicit operation.
2. Change `scripts/local-ci-runner.sh` and `scripts/lib/local-integration-ci.mjs` to consume a local candidate ref/SHA and a locally available accepted-base ref.
3. Record base SHA, candidate SHA, synthesized tree SHA, commands, toolchain fingerprint, and expiry in gate evidence.
4. Make stale/missing base explicit. If a recent remote base cannot be fetched, report the accepted local base age; do not fabricate freshness.
5. Update `.githooks/pre-push-gate` so docs-only bypasses compare against a configured local base ref instead of a hard-coded remote name.

Verification: disconnect network; prove the full local gate runs and records evidence. Reconnect; prove the same candidate can publish without rerunning unless policy/freshness requires it.

## Phase 3 — Local admission and serialized integration

**BI-5A43962A — Make local integration records and serialized integration refs authoritative offline** (`xlarge`)

1. Audit existing `FeatureBuild`, Work Capsule, activity/evidence, contribution, and local-integration models before proposing persistence.
2. Add the minimal canonical change/review/check/admission shape with fleet-safe migrations if required.
3. Implement local DCO validation over all candidate commits.
4. Implement approval binding, discussion resolution, and invalidation when candidate content changes.
5. Implement content-addressed required checks and a policy-versioned admission evaluator.
6. Implement single-writer lease + compare-and-swap promotion of the integration ref.
7. Run in shadow mode beside GitHub; capture verdict differences and never auto-advance public `main`.
8. Generalize `scripts/pr-health.mjs` into an admission-health core with a GitHub projection reader.

Verification: concurrency tests, stale-base rejection, post-approval mutation rejection, missing-check rejection, DCO rejection, unresolved-thread rejection, and exact-tree revalidation.

## Phase 4 — Durable remote outbox

**BI-C9EF928C — Add durable GitHub operation outbox with idempotent retry and reconciliation** (`large`)

1. Define remote-operation state machine: queued, attempting, retryable, needs-attention, terminal-failed, reconciled.
2. Persist idempotency keys and attempt history without storing secrets.
3. Classify TLS/EOF/DNS/429/5xx as retryable and auth/policy/divergence as attention/terminal.
4. Reconcile before replay; detect operations that succeeded before a lost response.
5. Expose lag/freshness to operator and automation; remote lag cannot masquerade as completion.
6. Route push, PR upsert, status projection, and merge/publication requests through the outbox.
7. Require every operation to carry an explicit egress class: local integration, own repo, public hive, or release distribution.
8. For public-hive dispatch, re-evaluate live contribution mode, pause, consent, DCO, disposition, and private paths; transition disallowed work to `policy-blocked`.
9. Construct public branches from the approved stripped payload, never by mirroring the private-inclusive integration ref.

Verification: deterministic fault injection at every request boundary, restart recovery, duplicate suppression, credential rotation, and remote divergence handling.

## Phase 5 — Portal Hive Mind projection

**BI-76CE0BF1 — Project local integration state into the portal Hive Mind work surface** (`large`)

1. Extend `PortalContextEnvelope` with references/projections for local change, admission, evidence freshness, contribution disposition, and remote reconciliation; do not duplicate source or evidence.
2. Add typed attention signals for delayed projection, policy-blocked contribution, stale Hive ingress, and advanced integration head.
3. Extend `resolveHiveMindCandidates` so reviewers/testers are required for missing admission evidence, architects are suggested for segregation/policy conflict, and operators handle reconciliation stalls.
4. Persist coworker work through existing Work Capsule, `TaskRun`, `TaskArtifact`, activity, and evidence records.
5. Synchronize forge comments/reviews as projections with principal mapping and idempotency; local review remains usable during outage.
6. Add plain-language states: “Saved and verified locally; community sharing is waiting for connectivity” and “Kept on this system; nothing is queued publicly.”

Verification: disconnect all forge access; drive architect/reviewer/tester work from the portal; confirm artifacts and admission evidence persist and remote lag is truthful.

## Phase 6 — Self-upgrade source neutrality

**BI-058F7AA8 — Align self-upgrade with forge-neutral upstream refs and cached release provenance** (`large`)

1. Extract upstream discovery/source acquisition from GitHub-specific transport.
2. Define verified release manifest and cache, including source/ref identity, artifact digests, signature/provenance, and observed-at time.
3. Preserve `dpf/install`, isolated merge workspace, conflict deferral, quiescence, recovery point, image stamping, health, and rollback.
4. Implement truthful offline outcomes: current-version continuation, verified cached release, verified imported bundle, or blocked.
5. Add cross-platform watchlist entries for any host-coupled path/service introduced.

Verification: GitHub unavailable, cache present/absent/corrupt, bundle valid/invalid, conflict defer, image identity, and rollback.

## Phase 7 — Hive/public egress preservation

**BI-873E5C38 — Preserve public hive DCO identity and private/public egress across forge adapters** (`large`)

1. Keep contribution disposition and private-path stripping before adapter selection.
2. Preserve the canonical two-state install mode (`private | contributing`) and per-change human authority (`private | shareable`).
3. Preserve public contributor identity, DCO trailers, consent, pause, `FeaturePack`, `ImprovementProposal`, and `HiveContributionLedger` behavior.
4. Model public publication as asynchronous egress from an already-governed local change, with live policy re-evaluation at dispatch.
5. Ensure private changes have no public outbox entry, mirror ref, or public payload.
6. Allow a private implementation to produce a separately classified, reviewed, and sanitized generic learning; never inherit shareability from the source change.
7. Reconcile GitHub PR state without making it the source of contribution disposition.

Verification: private, shareable, paused, credential-expired, timeout, retry, duplicate, and post-publication audit cases.

## Phase 8 — Network-tolerant commons ingress and propagation

**BI-8C59BAEA — Make Hive learning ingress and commons propagation network-tolerant** (`large`)

1. Inventory the existing learning router, WWMD/WWWD/WSID destinations, Hive Scout cursor/deduplication, Feature Packs, improvement proposals, and contribution ledger.
2. Keep same-install retrieval entirely local and surface the age/provenance of the last ingested public commons.
3. Add durable outbound state for approved code, principle, fact, and skill contributions without treating enqueue as consent to send.
4. Add durable inbound adapter cursor and idempotent reconciliation after outages.
5. Route reconnected inbound findings through existing review/backlog gates; no automatic knowledge/code activation.
6. Prove org overlays, install-specific config, and proprietary source context never enter a public artifact.

Verification: offline retrieval, stale indicator, reconnect cursor resume, duplicate inbound event, changed contribution policy, private-derived generic learning, and rejected/tampered Feature Pack.

## Phase 9 — Optional forge and air-gap exchange

**BI-72C751B9 — Evaluate optional Forgejo/Gitea integration provider and offline bundle exchange** (`medium`)

1. Stand up an isolated evaluation instance only after operator ratification; do not add it to the default install.
2. Run adapter conformance for branches, PRs, reviews, checks, protected branches, webhooks, and release/issue capabilities.
3. Threat-model Actions runners and fork-PR workflow trust.
4. Determine the serialized-integration implementation needed to match the local admission guarantee.
5. Implement bundle export/import staging with `git bundle verify`, manifest signature, prerequisite checks, and namespace isolation.
6. Decide whether the adapter is production-supported, experimental, or rejected with evidence.

Verification: service outage, runner outage, mirror lag/divergence, fork workflow approval, full/incremental bundle, missing prerequisites, tampered manifest, and duplicate import.

## Phase 10 — Authority cutover (separate operator approval)

No BI advances to this phase automatically.

1. Review shadow-parity evidence and unresolved mismatches.
2. Run architecture, security, data, and UX fit reviews.
3. Select a limited scope for local authority (for example install integration branches before public upstream `main`).
4. Provide a one-command rollback to GitHub-authoritative operation without losing local ledger/outbox state.
5. Cut over only with explicit operator approval and record the decision ledger.

## Evidence matrix

| Guarantee | Required evidence |
|---|---|
| Required checks | exact synthesized tree SHA + policy version + complete passing check set |
| Queue safety | stale-head race test and serialized lease/CAS proof |
| DCO | unsigned/malformed/multi-commit regression suite |
| Human review | approval binding, revocation, unresolved discussion, post-review mutation |
| Offline operation | network-denied end-to-end local admission and durable queued publication |
| Reconciliation | timeout-after-success and remote-divergence fault tests |
| Self-upgrade | cached/imported provenance, conflict defer, identity, rollback |
| Hive boundary | private bytes absent from all public refs/outbox payloads |
| Contribution mode | private/paused/withdrawn/changed-disposition entries blocked at dispatch |
| Portal Hive Mind | offline coworker review/test/architecture artifacts persist through canonical task/evidence records |
| Commons propagation | local retrieval offline; inbound/outbound resume from durable cursors without duplicates or policy bypass |

## Documentation updates per phase

- `AGENTS.md` Git workflow and verification doctrine;
- `docs/testing/pre-pr-gate.md` and `docs/testing/pr-health.md`;
- deployment Contract 1 if release distribution changes;
- self-upgrade and contribution specs;
- install/platform-support watchlist for new host coupling;
- operator runbooks for outage, queue reconciliation, and bundle import/export.
