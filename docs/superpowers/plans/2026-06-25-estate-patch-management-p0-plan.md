# Estate Patch Management — P0 implementation plan

- **Date:** 2026-06-25
- **Status:** Read-only posture COMPLETE — feed → projector → binding → daily sweep → `/ops/patches` surface. (MCP tool + Attention-Surface routing are optional follow-ups.)
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
- **`osv` adapter — LANDED (pure):** `packages/db/src/patch/osv-adapter.ts` turns OSV vuln objects into `AdvisoryInput` (severity band, lowest fixed version, CVE/GHSA aliases), generalized beyond npm to any ecosystem. Mirrors the proven shape in `scripts/sbom/scan-dependencies.mjs`.
- **`cisa-kev` adapter — LANDED (pure):** `parseKevCatalog` + KEV enrichment in `osvVulnToAdvisory` mark an advisory exploited when its CVE alias is in the catalog.
- **Live OSV + KEV fetch + provider — LANDED:** `apps/web/lib/patch/osv-client.ts` (OSV `/v1/query` per package), `kev-client.ts` (CISA KEV catalog), `ecosystem-map.ts` (package-manager → OSV ecosystem, null for OS managers needing distro context), `patch-intel-provider.ts` (`createOsvPatchIntelProvider` — injected fetch, unit-tested; returns null rather than fabricate when OSV is unreachable/empty). v1 yields **vulnerability + KEV** findings for language ecosystems; OS-package version-gaps + EOL await the native-manager adapter.
- **Scheduled job — LANDED:** `apps/web/lib/queue/functions/patch-assessment-sweep.ts` (`ops/patch-assessment-sweep`, daily 05:00) runs `runEstatePatchAssessment` behind the quiescence gate; registered in `scheduledFunctions` + `SCHEDULED_JOB_CATALOG` (parity-test guarded). Exercises the real DB writes end-to-end on the deployed install — the self-upgrade is the integration test.
- `native-manager` adapter (Edge Node on-host "installed → available") + `eol` adapter — **Remaining**, depend on the Edge Node software-inventory capability.

### Slice 3 — Assessment projector → AssuranceFinding (BI-489A8BB4)
- **Pure core — LANDED:** `packages/db/src/patch/patch-projector.ts`. A `PatchAssessmentStore` port + `runPatchAssessment` orchestration (read evidence → `assessEvidence` → `evidenceToPatchFinding` → upsert actionable findings → resolve now-clean ones → posture summary), plus `applyViaForPackageManager`. Decoupled from Prisma so the whole read→assess→upsert→resolve flow is unit-tested against an in-memory fake store. Emits the AssuranceFinding upsert shape (`findingKind` ∈ patch-gap|vulnerability|end-of-life; `adapterKey` patch-intel|osv|cisa-kev; stable `findingKey` = `patch:<evidenceKey>`). **No new findings table** — composes the Assurance Ledger (`schema.prisma:4968`).
- **Prisma binding — LANDED (unit-verified):** `apps/web/lib/patch/patch-assessment-store.ts` (`createPrismaPatchStore` + `runEstatePatchAssessment`) implements the port against the live DB: lists `DiscoveredSoftwareEvidence`, **delegates finding writes to the existing `apps/web/lib/assurance/finding-persistence.ts`** (single source of truth — no parallel upsert), opens/closes an `AssuranceRun` (`scopeType=estate`), and resolves now-clean findings scoped by the `patch:` key prefix. `apps/web/lib/patch/finding-mapping.ts` translates the patch vocabulary to the canonical Assurance enums (patch-gap→`missing-patch`, end-of-life→`unsupported-component`, affected→`inventory-entity`) — verified by 7 apps/web vitest cases against an in-memory fake db; both `@dpf/db` and `web` typecheck clean. Pure modules exposed via the new `@dpf/db/patch` subpath. **Remaining:** a real-DB write smoke via the local-CI sandbox lease, and a coverage metric.

### Slice 4 — Identity convergence (BI-676A7960) — gated
Map the `DiscoveryFingerprint*` subsystem first; decide whether the software-identity spine extends it or lands a focused `CatalogIdentity` + `SoftwarePatchProfile`. Then the reviewable migration for `softwareIdentityId` (rename→`legacy…` + add `catalogIdentityId`, or drop-with-evidence) per the lifecycle-evidence spec §7.4. Runs through Prisma in the sandbox/canonical install, never blind. Until then, slice 3 keys findings on `DiscoveredSoftwareEvidence`/`InventoryEntity` directly.

### Slice 5 — Posture surface (BI-020EE402)
- **Read model — LANDED:** `apps/web/lib/patch/patch-posture.ts` (`getPatchPosture`) projects the `patch:*` findings into totals (by severity/kind, KEV count, host count) + a severity/KEV-sorted, capped finding list; db injected for unit testing.
- **`/ops/patches` surface — LANDED:** `apps/web/app/(shell)/ops/patches/page.tsx` — summary tiles (open findings, critical/high, KEV, affected hosts) + a filterable finding list using report-kit `StatusBadge` (severity colors via `statusColors`); added the **Patches** tab to the Ops nav; route manifest regenerated. Progressive disclosure (derived counts + three plain filters); UX-Fit attested in the commit.
- **Remaining (optional follow-ups):** a `list_patch_posture` MCP tool (coworker/agent access) and routing critical/KEV items to the Attention Surface "needs you" inbox.

## Verification

- **Slice 1:** `pnpm --filter @dpf/db exec vitest run src/patch/patch-intel.test.ts` (source-local; deps installed in-worktree, or via the local-CI sandbox lease).
- **Slices 2–3:** unit tests for adapters/projector; projector integration verified against a leased nonprod environment (writes real `AssuranceFinding` rows).
- **Slice 4:** migration apply/rollback evidence via the sandbox/canonical install — not the worktree.
- **Slice 5:** `next build` + UX exercise of `/ops/patches` via the canonical install per AGENTS.md §13.

## Risks

- Identity convergence touching the live `DiscoveryFingerprint*` subsystem — mitigated by the mapping pass in slice 4 and keeping slices 1–3 identity-agnostic.
- OSV/native coverage gaps for niche apps — surfaced as low-confidence `none`/`patch-gap`, never a false-clean.
- Source-only worktree limits local runtime gates — routed to the sandbox per doctrine.
