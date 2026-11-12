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

### 6. Same-promotion Edge dispatch configuration (BI-EEFCB232)

This ordered corrective plan extends the shared promoter contract, including
git-source mode. It does not change release target admission or reopen the
delivered BI-084F85E5. The existing `ensureRemoteActionDispatch` rule currently
persists only during the release-identity commit, after the portal was recreated;
source mode skips that commit. A missing configured-channel default can therefore
remain off in the new process despite the intended initializer.

**OBJ-PDC1:** The first normal portal recreation consumes the existing configured
Edge channel's intended default, in source and release modes.

**OBJ-PDC2:** Explicit operator values and one-shot overrides retain their
authority; convergence does not turn an override into persisted intent.

**OBJ-PDC3:** A successful promotion preserves restart configuration, while
refused, dry-run, build-only and failed persistence paths remain truthful.

| Acceptance | Objectives | Statement | Verification |
| --- | --- | --- | --- |
| AC-PDC1 | OBJ-PDC1 | Derive the configured-channel default before the first Compose operation that can recreate the portal, in both promotion modes. | Production-promoter functional fixtures |
| AC-PDC2 | OBJ-PDC2 | Keep explicit process and selected-file values, including zero, and never persist a one-shot override. | Resolver and precedence fixtures |
| AC-PDC3 | OBJ-PDC3 | Commit only a derived missing default after successful runtime verification, with explicit persistence/restoration failure and retained recovery evidence. | Persistence and failure fixtures |
| AC-PDC4 | OBJ-PDC1, OBJ-PDC2, OBJ-PDC3 | Preserve ordinary upgrade admission, identities, quiescence, rollback, signed action policy and separately owned native operations. | Adjacent tests and exact merged-source gate |

The recorded BI-EEFCB232 acceptance criteria are:

- A production-promoter fixture proves that configured1 plus an absent dispatch key reaches the first portal recreation as1 in both git-source and release modes; normalization precedes that recreation rather than relying on a later release-assets write.
- Existing explicit dispatch values, including0 and1, remain unchanged across supported process/environment-file precedence, quoted/LF/CRLF input and unconfigured channels; missing or unreadable inputs do not authorize a guessed enablement.
- Successful supported convergence preserves the resolved value for subsequent normal starts; dry-run/build-only/refused paths do not write install configuration, and persistence/rollback failures remain explicit without manual reload or replay.
- Existing release identity, operator-owned configuration, signed action policy, certificates, enrollment, host task/controller, model/provider settings and all historical UNKNOWN requests remain unchanged. Deterministic source tests and normal exact-source gate/protected publication supply source evidence; live action-channel and inference acceptance remain separately owned.

#### Ownership and precedence

This uses the existing runtime env schema and inherits deployment Contract 12;
there is no new flag store, install-state field or database setting. Organization
PKI/trust configuration retains its existing owner. Its configured marker and the
persisted dispatch initializer/explicit setting use the existing install `.env`
contract. The promoter reads the recorded `PROMOTE_COMPOSE_ENV_FILE`, falling back
only when no explicit file was selected, as Compose does. It must not read a
different workspace `.env` to hide an unavailable selected input.

A real per-invocation process override wins, then the selected persisted runtime
setting, then the existing documented default. Preserve presence as well as
value: explicit zero, one, empty or invalid values are not absence and cannot
authorize synthesized enablement. The normal promoter command builder does not
forward the portal's default-zero dispatch environment into the promoter; an
actual promoter override must still be preserved. The initializer is eligible
only for a verified configured marker of one with no explicit dispatch setting.
Use one shared pure resolver beside the current release-assets rule; retain
supported quoting/newlines and preserve unrelated env bytes. Ambiguous owned-key
assignments cannot become guessed enablement; unsupported input fails closed.

The normal promoter may export a derived value before Compose so the first
replacement receives it. Capture original process presence and value before
deriving anything, and keep that origin in local procedure state; never persist
an operator's one-shot override. Existing explicit file values remain untouched.
Release-assets installation and source-mode finalization must consume the same
rule. Only a successfully verified promotion may persist a derived missing
default, through the existing selected-file write owner and a narrow recovery
snapshot. Recheck the selected input before writing: changed intent fails closed
rather than overwriting it. A write or restoration failure must return failure,
retain its recovery checkpoint and never claim that restoration occurred. Do not
change the immutable release assets/state commit ordering or add a second portal
recreation. No secret or unrelated env value is emitted by the resolver.

An exported derived one must be unwound before every existing rollback Compose
call: restore the original process presence/value, unsetting the variable when
it was originally absent, before recreating an old image. Restoring file bytes
alone is insufficient because the derived process value would still win. A
production-promoter failure fixture must derive one, fail release identity or
persistence, and observe effective default zero at the actual rollback portal
recreation. A source-mode post-swap persistence failure must retain truthful
runtime/configuration uncertainty and recovery evidence; restoring this
promoter's environment does not prove the already-running portal was restored.

#### Ordered implementation and verification

1. **Red fixtures:** exercise the real promoter through the existing fake-Docker
   functional harness in both git-source and release modes. Record the effective
   dispatch value at the first portal recreation; reproduce the missing default.
   Add explicit process/file zero and one, quoted/LF/CRLF, unconfigured, missing or
   unreadable selected input, dry-run/build-only, conflict and persistence failure
   cases, including the effective value at rollback recreation after a derived
   default and failed release commit. Test the shared file policy without a live
   runtime.
2. **Shared policy and pre-Compose resolution:** extend
   `scripts/installer/install-release-assets.mjs` and the existing promoter env
   handling. Keep an explicitly supplied process value and selected-file intent;
   export only a verified missing configured-channel default before Compose.
   Keep helper invocation limited to these two public configuration keys.
3. **Truthful persistence:** retain release-assets transaction ownership, add the
   corresponding source-mode finalization, and preserve one-shot overrides. Verify
   persisted readback or retain the bounded recovery snapshot and failure. Unwind
   a synthesized process override before each existing rollback Compose call;
   do not add a second success-path recreation. Never use a manual reload, a
   convergence-marker reset or a second accidental release.
4. **Verification and publication:** run the affected Node source suite, the
   production-promoter functional tests, both affected package typechecks and every
   test/guard from the claimed scope's impact contract. Use the canonical merged
   local-CI lane, a DCO-signed ready PR, protected merge-group production checks and
   exact final source review. Existing certificate source and model evidence are
   reused only where unchanged; no model call verifies this configuration repair.

The resolved Workroom impact contract requires `node scripts/check-style-drift.mjs`
and a fresh doc index (`node scripts/gen-doc-index.mjs --check`). Its related-test
reader resolved the six existing `promote-safe-directory`, `promote-script-cleanup`,
`promote-script-fake-docker`, `promote-script-functional`,
`promote-script-legacy-bootstrap` and `promote-script-service-reconcile` test files;
include all six alongside the new case and installer source suite. The new module
stays below its 800-line cap. Missing or stale advice expands verification.

These steps are one atomic BI: the policy, current-process export, persistence
and negative evidence establish one convergence contract and cannot ship as
independent completed outcomes. Plan coverage maps AC-PDC1--4,
CONTRACT-PDC-CONFIG (deployment Contracts 2/12), FLOW-PDC-PROMOTE
(resolve, recreate, verify, persist) and VERIFY-PDC-FIXTURES to BI-EEFCB232.

Expected edit scope is this design, `scripts/promote.sh`,
`scripts/installer/install-release-assets.mjs` and its existing test file,
`apps/web/lib/self-upgrade/promote-script-functional.test-support.ts`, and one
adjacent dispatch-convergence functional test. This excludes the certificate
owner's ten files, credentials, action allowlists and native/model operations.
Any additional prerequisite or authority refusal is reported before widening
that scope. Actual allowed implementation admission and independent frozen-plan
assessment remain required; this document is not an approval receipt.

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

