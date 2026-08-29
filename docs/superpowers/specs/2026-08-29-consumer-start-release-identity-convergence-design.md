---
title: Consumer start-path release identity convergence
status: draft
backlog_item: BI-6CB35411
workroom: WC-DD034A30
---

# Consumer start-path release identity convergence

## Problem

A successful source-isolated consumer self-upgrade commits release assets and
`DPF_IMAGE_TAG` into the isolated upgrade workspace, while the host start path
later runs Compose from the canonical install root. The canonical root can
therefore retain `DPF_IMAGE_TAG=latest`. A subsequent `dpf-start.ps1` resolves
that mutable tag and can silently replace a verified current release with an
older cached image.

This is a split-brain release identity defect. The state file records the new
release correctly, but the install root used by Compose does not. The fix must
make promotion and restart consume one durable identity without turning the
consumer install into a source checkout or weakening immutable image checks.

## Governed scope manifest

- **OBJ-CSRI-001:** A successful release promotion commits the verified release
  tag and managed release assets to the canonical install root used by future
  host lifecycle commands.
- **OBJ-CSRI-002:** The Windows start path treats validated install-state
  `imageTag` as the authoritative release tag and cannot silently fall back to
  a contradictory mutable `latest` value.
- **OBJ-CSRI-003:** Identity commit and rollback remain atomic across managed
  assets, root `.env`, release marker, and install-state.
- **OBJ-CSRI-004:** Existing contributor/source installations and legacy
  consumer installs retain an explicit, fail-closed compatibility path.
- **OBJ-CSRI-005:** Operators can read the deployed source identity from the
  existing public version endpoints after restart.

| Acceptance criterion | Objective links | Required evidence |
|---|---|---|
| **AC-CSRI-001:** An isolated release promotion writes the candidate tag to the canonical install root `.env` and `.verified-release-assets-version`, while install-state records the same tag. | OBJ-CSRI-001, OBJ-CSRI-003 | Functional promoter fixture with distinct workspace and install-root directories. |
| **AC-CSRI-002:** `dpf-start.ps1` exports a validated consumer `imageTag` from install-state before Compose interpolation; a contradictory root `.env` cannot select `latest`. | OBJ-CSRI-002, OBJ-CSRI-004 | PowerShell lifecycle contract test covering recorded-tag precedence. |
| **AC-CSRI-003:** A consumer release install with missing or malformed recorded identity fails before `docker compose up`; contributor/source installs retain their existing behavior. | OBJ-CSRI-002, OBJ-CSRI-004 | Windows start-path negative and compatibility cases. |
| **AC-CSRI-004:** Any failure during the canonical identity commit restores managed files, root `.env`, release marker, and install-state, and the promoter rollback uses the prior tag. | OBJ-CSRI-003 | Injected-failure transaction and promoter functional tests. |
| **AC-CSRI-005:** `/api/platform/version` and `/api/platform/image-version` report the restarted container's baked SHA/version after the recorded tag is used. | OBJ-CSRI-005 | Existing route contracts plus live post-release verification. |

## Evidence and root cause

- `scripts/promote.sh` calls `install-release-assets.mjs --install
  "$PROMOTE_SOURCE"` during `release-identity-commit`.
- With isolated source enabled, `self-upgrade.ts` passes the workspace host path
  to `runPromoter`; the promoter mounts it at `/host-source`.
- `install-release-assets.mjs` writes `.env` and
  `.verified-release-assets-version` beneath its `installDir`, so both writes
  land in the workspace.
- `dpf-start.ps1` runs Compose from `$DPF_DIR` and never reads install-state
  `imageTag`. The release overlay therefore resolves `DPF_IMAGE_TAG` from the
  canonical root `.env`, whose legacy value may be `latest`.
- The running portal already exposes baked identity at
  `/api/platform/version`, `/api/platform/image-version`, and `/api/health/sha`;
  no new identity endpoint is required.

## Decision

Use a **canonical install-root identity transaction plus state-authoritative
start projection**.

The promoter receives the canonical host install path separately from its
build/source workspace. In isolated release mode it mounts that exact directory
at a fixed in-container path. `promote.sh` commits verified release assets and
identity to that canonical root only after candidate health and source/content
verification. Non-isolated release mode aliases the canonical root to
`PROMOTE_SOURCE`, preserving the existing path.

The Windows start path reads validated install-state through the existing
`state.ps1` library. For a consumer release install it sets the process-level
`DPF_IMAGE_TAG` to the recorded `imageTag` before invoking Compose. Process
environment precedence deliberately prevents a stale root `.env` or mutable
`latest` from selecting different bytes. A missing or malformed consumer tag is
an actionable hard stop, not a fallback.

## Architecture

### 1. Separate source carrier from canonical install root

Extend the existing promoter command contract with an optional
`canonicalInstallPath` host path. Validate it with the same absolute-host-path
rules used for other lifecycle mounts. When it differs from `hostInstallPath`,
mount it read-write at `/canonical-install`; otherwise reuse `/host-source`.
Pass only the fixed in-container path to `promote.sh`.

The new mount does not create a new authority surface: the promoter already
owns the release-assets transaction, Docker swap, and rollback. It narrows the
write target from an accidentally isolated workspace to the install root named
by validated install-state/configuration.

### 2. Keep one release-assets transaction

`install-release-assets.mjs` remains the sole transaction owner. It receives
the canonical install directory for release mode and continues to:

1. verify every staged asset against `SHA256SUMS`;
2. snapshot managed files, `.env`, release marker, and install-state;
3. atomically replace only manifest-managed files and release identity;
4. update install-state under its existing transaction/CAS contract;
5. restore every snapshot on any failure.

The source workspace is never treated as durable installed identity. Promoter
rollback composes from the same source carrier but interpolates the restored
canonical root `.env`.

### 3. Make install-state authoritative at host start

After importing `state.ps1`, `dpf-start.ps1` resolves the install mode and
recorded image tag before resolving Compose arguments.

- Consumer/release install + valid recorded tag: set
  `$env:DPF_IMAGE_TAG` to the recorded value and print the chosen immutable tag.
- Consumer/release install + missing or invalid recorded tag: throw a named
  `consumer_release_identity_missing` or
  `consumer_release_identity_invalid` error before Docker mutation.
- Contributor/source install: preserve existing local image/build behavior.
- Explicit environment disagreement on a consumer install is reported, but the
  validated recorded identity wins; there is no hidden downgrade override.

Legacy installs whose state predates `installMode` remain on their current
behavior until migrated by the existing installer-state migrator. Compatibility
does not permit a known consumer with incomplete identity to use `latest`.

### 4. Preserve distinct ownership boundaries

- BI-3FD07259 / WC-25858CAB owns durable self-upgrade request admission,
  dispatch, and reconciliation. This change does not edit that state machine.
- BI-7175C7DB owns MCP actor propagation for Build Studio brief updates and is
  already protected-merged.
- Release publication policy for mutable `latest` is separate. This repair no
  longer depends on `latest` being fresh, but it does not change publication.
- No database schema or new operator control is introduced.

## TDD and verification

1. Add a red functional fixture with distinct workspace/canonical-root paths;
   prove current code updates only the workspace, then require root env/marker,
   state convergence, and rollback.
2. Add red promoter-command tests for the canonical-root mount, fixed container
   path, path validation, and non-isolated alias behavior.
3. Add red PowerShell lifecycle cases for recorded-tag precedence, stale
   `latest`, missing/malformed consumer identity, and unchanged contributor
   behavior.
4. Run affected promoter, installer transaction, lifecycle-contract,
   self-upgrade orchestration, and public version-route tests plus web typecheck,
   source policy, DCO, and exact-tree CI.
5. Reserve roughly one fifth of implementation effort for refactoring: name the
   source-carrier versus canonical-install concepts consistently, centralize tag
   validation/projection, and remove duplicate ad-hoc env interpretation. Do not
   broaden into dispatch or publication policy.
6. After protected release, verify one governed upgrade and one ordinary
   `dpf-start.ps1 -NoBrowser` restart preserve the same tag, SHA, health, data,
   and public version projection.

## Fail-closed conditions

- Canonical install path absent, relative, contradictory, or not mountable.
- Consumer install-state missing a valid immutable release tag.
- Manifest, asset, OCI, or post-swap source identity disagreement.
- Partial identity commit or rollback failure.
- Compose resolves a tag different from the recorded consumer identity.

## Non-goals

- Changing self-upgrade admission/dispatch semantics.
- Requiring a Git checkout on consumer installs.
- Publishing or redefining the mutable `latest` channel.
- Adding a second version endpoint or Upgrade Center control.
- Editing installed runtime files as platform source.
