# Estate Patch Management — P0 implementation plan

- **Date:** 2026-06-25
- **Status:** In progress (slice 1 landed)
- **Spec:** `docs/superpowers/specs/2026-06-24-estate-patch-management-design.md`
- **Epic:** `EP-PATCH-MANAGEMENT`
- **Backlog:** BI-CAA0043C (version-intel feed), BI-489A8BB4 (assessment projector), BI-676A7960 (identity convergence), BI-020EE402 (posture UX)

This plan sequences the **read-only P0 wedge** — estate patch posture with zero execution risk — built locally (not Build Studio, per operator direction). It deliberately starts with pure, unit-testable logic and defers the high-stakes schema migration until the existing identity substrate is mapped.

## Substrate corrections discovered while planning (verify-first)

These reshaped the sequence and are recorded so the next session does not re-derive them:

1. **No `CatalogIdentity` model exists.** The `2026-04-18-lifecycle-evidence-specialist-design.md` spec proposes it, but what actually landed is a *device-oriented* fingerprint subsystem: `DiscoveryFingerprintRule`, `DiscoveryFingerprintCatalogVersion`, `DiscoveryFingerprintObservation`, `DiscoveryFingerprintReview` (`packages/db/prisma/schema.prisma:3642–3731`, migration `20260425113500_discovery_fingerprint_foundation`). The canonical *software*-identity spine is genuinely unbuilt and **intersects** this subsystem — so the identity-convergence slice must map it first, not invent a parallel model.
2. **`DiscoveredSoftwareEvidence.softwareIdentityId` (`schema.prisma:3633`) is still a dangling `String?`** with no relation — confirmed live.
3. **The worktree is source-only** (no `node_modules`). Per AGENTS.md §5, targeted unit tests run source-local once deps are installed; runtime-bound gates (Prisma migrate, `next build`, UX) route through the shared local-CI sandbox lease or the canonical install. A blind, immutable-after-commit identity migration is therefore **not** the right first slice.

## Slices (ordered, value-early)

### Slice 1 — Patch-intelligence core (this PR)
`packages/db/src/patch/patch-intel.ts` (+ `.test.ts`). Pure, prisma-free, no new dependency (a small self-contained semver comparator — DPF has no `semver` dep and we are not adding one). Provides:
- `compareVersions` / `parseVersion` — semver-ish comparison that returns `"unknown"` for non-semver OS strings rather than guessing.
- `assessPatchState` — classifies a `(host, software)` pair into `vulnerability | end-of-life | patch-gap | none` with precedence advisories → EOL → behind → none; **CISA KEV escalates severity and routes urgently**; emits the `remediationHint` shape (`targetVersion`, `applyVia`, `rebootLikely`, `cisaKev`, `confidence`).

This is the shared brain for both BI-CAA0043C and BI-489A8BB4 and is independently verifiable.

### Slice 2 — Version-intelligence adapters → feed (BI-CAA0043C)
Adapter interfaces + implementations that produce `assessPatchState` inputs, each gated by the Tool Evaluation Pipeline before embed:
- `osv` adapter — generalize the existing npm OSV usage (`scripts/sbom/scan-dependencies.mjs`) to all ecosystems incl. OS packages and container images; returns advisories with `fixedVersion`.
- `cisa-kev` adapter — KEV catalog membership for CVE ids.
- `native-manager` adapter — the Edge Node's on-host "installed → available" output (`winget show`, `apt-cache policy`, `dnf check-update`, `brew outdated`).
- `eol` adapter — end-of-life dates.
Scheduled projector entry in `SCHEDULED_JOB_CATALOG`.

### Slice 3 — Assessment projector → AssuranceFinding (BI-489A8BB4)
For each in-use `(InventoryEntity, DiscoveredSoftwareEvidence)`, run `assessPatchState` and upsert `AssuranceFinding` rows (`findingKind` ∈ patch-gap|vulnerability|end-of-life; `adapterKey` patch-intel|osv|cisa-kev|native-manager; `vendorIdentifier` = primary advisory; `remediationHint` JSON; `acceptedUntil` preserved). **No new findings table** — composes the Assurance Ledger (`schema.prisma:4968`). Carries a coverage metric so missing inventory is not read as clean.

### Slice 4 — Identity convergence (BI-676A7960) — gated
Map the `DiscoveryFingerprint*` subsystem first; decide whether the software-identity spine extends it or lands a focused `CatalogIdentity` + `SoftwarePatchProfile`. Then the reviewable migration for `softwareIdentityId` (rename→`legacy…` + add `catalogIdentityId`, or drop-with-evidence) per the lifecycle-evidence spec §7.4. Runs through Prisma in the sandbox/canonical install, never blind. Until then, slice 3 keys findings on `DiscoveredSoftwareEvidence`/`InventoryEntity` directly.

### Slice 5 — Posture read model + MCP tool + UX (BI-020EE402)
`list_patch_posture` MCP tool (capped/paginated/provenance-free) and the `/ops/patches` surface composed from report-kit (`StatusBadge`/`DataTable`/`StatCard`), with the "needs you" items routing to the Attention Surface. Carries the UX-Fit attestation.

## Verification

- **Slice 1:** `pnpm --filter @dpf/db exec vitest run src/patch/patch-intel.test.ts` (source-local; deps installed in-worktree, or via the local-CI sandbox lease).
- **Slices 2–3:** unit tests for adapters/projector; projector integration verified against a leased nonprod environment (writes real `AssuranceFinding` rows).
- **Slice 4:** migration apply/rollback evidence via the sandbox/canonical install — not the worktree.
- **Slice 5:** `next build` + UX exercise of `/ops/patches` via the canonical install per AGENTS.md §13.

## Risks

- Identity convergence touching the live `DiscoveryFingerprint*` subsystem — mitigated by the mapping pass in slice 4 and keeping slices 1–3 identity-agnostic.
- OSV/native coverage gaps for niche apps — surfaced as low-confidence `none`/`patch-gap`, never a false-clean.
- Source-only worktree limits local runtime gates — routed to the sandbox per doctrine.
