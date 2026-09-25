---
status: active
---

# Converter on customizable installs: fix design (BI-4E18BC28)

Slice s9a of the office document engine
([plan](../plans/2026-09-22-office-document-conversion-plan.md),
[design](2026-09-22-office-document-conversion-design.md)). Profile: fix.
Shape: `delivery-medium@1.0.0`.

## Defect

Reproduced on `origin/main` at `dfc6c3f81af22f4c6df265bdccdbc2713ae4c53f`.

On a customizable, source-built install (`install-dpf.ps1` option [2],
installMode `customizer`; `install-dpf.sh --contributor`, installMode
`contributor`), `getConverterAvailability()` always reports `not-configured`:

- `packages/db/src/seed.ts:1410` seeds `self_upgrade.doctoolsImage` only from
  `DPF_DOCTOOLS_IMAGE`, and no compose file, installer or
  `.env.docker.example` passes that variable to `portal` or `portal-init`.
- `apps/web/lib/self-upgrade/release-target.ts:29` (`releaseMode`) accepts only
  `consumer` or `customer`, so `loadReleaseInstallContext()` is null and the
  BI-9A2EC54A reconciler returns `not-release-install`.
- Neither installer builds `Dockerfile.doctools`.

Failing proof: the new `reconcileReleaseDoctoolsImage on a customizable,
source-built install` tests in
`apps/web/lib/self-upgrade/doctools-release-image.test.ts` fail against the
unchanged reconciler with `expected { outcome: 'not-release-install' }` (7 of 9
fail; the two that pass assert what must not change).

Candidate causes ruled out:

- Making `parseReleaseInstallContext` accept `contributor`/`customizer`. Ruled
  out: the same context selects the upgrade strategy
  (`resolveUpgradeStrategy`), so a source install would start upgrading from
  release images.
- Having the installer resolve the digest and write `DPF_DOCTOOLS_IMAGE`.
  Ruled out: that value is operator precedence (it is seeded into the
  `self_upgrade` row), so it would freeze the pin at install time and go stale
  after the first source upgrade.
- Adding dpf-doctools to compose. Ruled out by watchlist D18: an optional
  pinned image in compose froze `promote-latest` (PR #5290).

## Fix

A source-built install has a release lineage even without an immutable
`DPF_IMAGE_TAG`. Every from-source build (both installers,
`scripts/build-images.*`, `scripts/promote.sh`) bakes
`git describe --tags --always` into the portal as `DPF_PLATFORM_VERSION`
(`/app/.dpf-platform-version`, read by `readPlatformVersionTag()`), for example
`2026.09.25-shape-raise.1-35-gbcaa30a8`. The describe base is the nearest tag
the built HEAD descends from, and `publish-image.yml` publishes dpf-doctools
under every `v*` tag. So the install can pin the published image exactly as a
release install does.

Deliverables, in order:

1. **D1 lineage.** `apps/web/lib/self-upgrade/doctools-source-lineage.ts`:
   `releaseTagFromPlatformVersion()` strips the describe distance and a dirty
   marker, then requires `RELEASE_IMAGE_TAG`. `loadSourceLineageContext()` pairs
   it with `GHCR_OWNER` and the `/host-dpf` clone mount.
2. **D2 reconciler.** `doctools-release-image.ts` consults the source lineage
   only when there is no release context. It resolves with the same
   `imagetools inspect` call, stores the pin in `self_upgrade.doctoolsImage`
   with `origin: "published"`, and pulls it by digest.
3. **D3 offline fallback.** When the published image is not reachable
   (`unavailable` or `not-published`), a source-built install builds
   `Dockerfile.doctools` from a scratch copy of its two build inputs
   (`Dockerfile.doctools`, `tools/doctools/`), never the whole clone. It pins
   the local image id with `origin: "local-build"`. Later ticks try the
   published image again, and rebuild only when the local image was removed.
   Release installs never build.
4. **D4 wiring and docs.** Compose passes `DPF_DOCTOOLS_IMAGE` to `portal` and
   `portal-init` as an operator override only, and `.env.docker.example`
   documents it as leave-unset. The install docs, `developer-setup.md` and
   watchlist D18 describe the behaviour.

A source upgrade re-stamps `DPF_PLATFORM_VERSION` (`promote.sh`), and the
reconciler runs at boot and every 20 minutes, so the new lineage re-resolves
the pin. The installers are unchanged: the pin belongs to the running portal,
not to install time.

## Scope manifest

**OBJ-AVAILABLE:** A customizable install has a digest-pinned converter image after install, with no manual step.

**OBJ-DURABLE:** The pin is carried by the install's own runtime and compose, and it follows upgrades.

**OBJ-DOCUMENTED:** Install and contributor docs describe how a customizable install gets its converter image.

| AC | Objective | Statement |
| --- | --- | --- |
| AC-1 | OBJ-AVAILABLE | On a customizable install, `getConverterAvailability()` reports available after install, with no manual step. |
| AC-2 | OBJ-DURABLE | The installers and compose carry the setting, pinned by digest, and it survives upgrade. |
| AC-3 | OBJ-DOCUMENTED | `docs/user-guide/contributing/developer-setup.md` and the install docs describe it. |

## Traceability

| Deliverable | Requirement | Contract | Flow | Verification |
| --- | --- | --- | --- | --- |
| D1 lineage | OBJ-AVAILABLE | `releaseTagFromPlatformVersion` | source-lineage-resolution | AC-1 |
| D2 reconciler | OBJ-AVAILABLE, OBJ-DURABLE | `reconcileReleaseDoctoolsImage` | doctools-pin-reconcile | AC-1, AC-2 |
| D3 offline fallback | OBJ-AVAILABLE | `buildLocalDoctoolsImage` | doctools-local-build | AC-1 |
| D4 wiring and docs | OBJ-DURABLE, OBJ-DOCUMENTED | `DPF_DOCTOOLS_IMAGE` | compose-override | AC-2, AC-3 |

## Verification

- `apps/web/lib/self-upgrade/doctools-source-lineage.test.ts` and
  `doctools-release-image.test.ts`: unit tests for D1 to D3.
- `pnpm --filter web typecheck`, and the pregate.
- AC-1 on a running customizable install is verified live after the release
  that carries this fix. A unit test cannot prove it.
