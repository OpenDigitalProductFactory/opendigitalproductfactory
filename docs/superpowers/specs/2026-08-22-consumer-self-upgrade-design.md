---
title: Consumer release-artifact self-upgrade
status: active
backlog_item: BI-89887875
decision_interaction: DI-2AB64991D7A4
---

# Consumer release-artifact self-upgrade

## Problem

Consumer installations deliberately contain verified release assets and pre-built images, not a Git checkout. The self-upgrade runtime nevertheless treats every `upstream` install as a source installation: it runs `git -C /host-dpf fetch` and `rev-parse origin/main`, prepares an isolated merge workspace, and asks the promoter to compile a new portal image. On a real Windows consumer install `/host-dpf` is the release-assets directory, so target resolution fails before the governed preflight can begin.

This is a contract mismatch, not a missing Git prerequisite. The production-install design explicitly promises no source checkout and no local portal build for consumers.

## Evidence

- The canonical install's `.install-mode` is `consumer`; `D:\DPF` contains verified release assets and no `.git`.
- Live runs `SUR-16B67995` and `SUR-16E9F749` skipped with `no-target`; portal logs show `git -C /host-dpf rev-parse origin/main` failing with `not a git repository`.
- `apps/web/lib/self-upgrade/version.ts` and `apps/web/lib/queue/functions/self-upgrade.ts` unconditionally use Git for the default `upstream` source mode.
- `docs/superpowers/specs/2026-03-22-production-install-design.md` makes consumer installs image-based and source-free.
- `.github/workflows/publish-image.yml` publishes immutable version tags only after building source-stamped multi-arch images; `latest` advances only after the release E2E gate passes.
- `apps/web/lib/release-health/release-runs-reader.ts` already knows whether the newest release stamp is verified, in progress, publish-failed, or verify-failed.
- `apps/web/lib/self-upgrade/promoter-artifact.ts` already validates an immutable promoter digest, source SHA, contract digest, and caller-protocol range before quiescence.

## Decision

Kernel consultation `DI-2AB64991D7A4` compared three approaches:

1. clone/download source temporarily and reuse the source-build path;
2. add a release-artifact strategy to the governed self-upgrade lifecycle;
3. delegate the operation to a host-side installer re-entry carrier.

The kernel selected **artifact-native** with high confidence and no commandment conflict. Consumer upgrades will resolve a verified published release, validate immutable candidate images, and reuse the existing preflight, quiescence, backup, migration, health, identity, and reconciliation envelope. Consumer installs remain source-free and do not compile locally.

## Contracts

### 1. Installation contract is authoritative

`~/.dpf/install-state.json` is the canonical local deployment contract. Before the portal is started, the Windows installer records in one convergence operation:

- the current absolute `installPath`;
- `installMode` (`consumer` or the contributor/customizer equivalent);
- the exact ordered `composeFiles` chain;
- the immutable consumer `imageTag`;
- the installer and last-successful installer versions;
- the rendered Compose identity/hash when available.

At runtime, self-upgrade overlays these installation facts onto stored `PlatformConfig`. A consumer/customer marker forces `sourceMode: release`; a contributor install retains the existing `upstream`/`local` behavior. A consumer marker with incomplete state returns `installer-state-repair-required` before any Git or Docker mutation.

For compatibility with pre-fix installs, `.install-mode` may identify the deployment as consumer even when install-state is stale. That compatibility signal selects the release strategy but does not waive the complete-state gate.

### 2. Release target resolution

The target is the newest **verified** release stamp from the existing release-health reader, not `origin/main` and not the mutable `latest` tag.

A resolved target contains:

- immutable source SHA (`head_sha` from the verified publish workflow);
- immutable release tag (`head_branch`, for example `v2026.08.22`);
- canonical registry owner derived from repository identity/configuration;
- explicit availability state.

Result semantics:

- same deployed SHA or current image tag: `up-to-date`;
- no release: `no-published-target`;
- publish/verification still running or failed: explicit release-health reason;
- malformed tag/SHA: `invalid-published-target`;
- verified newer release: continue to candidate preflight.

Release mode never invokes the Git runner, source preparation, merge batching, or local build-memory guard.

### 3. Immutable candidate artifacts

The release tag is a discovery handle. Before drain, Docker resolves candidate references and the system pins the promoter by digest. The candidate promoter must prove:

- OCI revision label equals the release target SHA;
- contract schema and digest match the embedded manifest;
- caller protocol compatibility;
- immutable digest syntax.

The release promoter pulls the recorded Compose chain under the candidate tag and verifies each DPF image's OCI revision before swap. The portal image supplies `/dpf-release-assets`; its `SHA256SUMS` covers every staged file and rejects unlisted content.

### 4. Promotion sequence

The release strategy enters the same lifecycle envelope as a source upgrade:

1. resolve verified target;
2. validate complete install-state and candidate promoter artifact;
3. run candidate-owned readiness before quiescence;
4. create the database/install-state recovery point;
5. drain through the Activity Quiescence Protocol;
6. pull and identity-check release images using the recorded Compose chain;
7. apply forward migrations from the candidate portal image;
8. recreate portal and refresh sandbox without a local build;
9. verify health, deployed SHA, and content hash;
10. atomically install the verified release-assets set and persist `DPF_IMAGE_TAG`/install-state identity;
11. reconcile the run after portal restart.

The canonical release-assets directory and `.env` remain unchanged until the candidate portal is healthy and identity-verified. The installer helper performs the final managed-file replacement transaction and preserves operator-owned `.env` lines.

### 5. Rollback and failure semantics

- A target-resolution, candidate-validation, pull, migration, or pre-swap failure leaves the current portal and release identity untouched.
- A release-assets staging or validation failure aborts before quiescence.
- The existing database backup and install-state recovery snapshot remain authoritative.
- The final assets/env commit uses a recovery directory and atomic file replacement. If it cannot commit, it restores managed files and identity bytes before returning failure.
- Existing source-upgrade rollback behavior is unchanged.

## UX behavior

The existing Upgrade Center remains the only surface; no new operator control is added. Its status vocabulary gains truthful consumer results:

- “Up to date on `<tag>`”;
- “No verified release is published yet”;
- “Release `<tag>` is still being verified”;
- “Installer state needs repair before upgrades can run.”

Raw Git errors and `skipped / no-target` are not shown for consumer installs.

## Compatibility

- Contributor `upstream` and `local` modes keep their current Git/source-build behavior.
- Linux `customer` and Windows `consumer` markers normalize to the same release strategy.
- Existing persisted `sourceMode` values remain valid; `release` is derived from the installation contract rather than an operator-editable preference.
- No database schema migration is required.

## Verification

- Pure tests for install-mode normalization and complete-state gating.
- Release target tests for verified, current, unavailable, failed, and malformed stamps.
- Orchestrator regression proving a non-Git consumer fixture reaches preflight without invoking Git/source preparation.
- Promoter command and script tests proving release mode mounts only the install/assets carrier writable, passes a candidate tag, pulls instead of builds, verifies SHA/content, and persists identity only after success.
- Installer contract test proving Windows consumer state records current path, compose chain, image tag, and successful installer version.
- Existing contributor upstream/local, preflight, promoter, rollback, and release-health tests remain green.
- Exact-tree local CI plus canonical-install preflight; live self-upgrade verification follows once a release containing this repair is installed.

## Non-goals

- Turning consumer installs into Git checkouts.
- Building portal images on consumer hosts.
- Changing release publication policy.
- Adding a second Upgrade Center or an operator-managed strategy selector.

