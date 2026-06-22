# Plan — Onboarding Intake P0: risk-posture home (dark/inert)

**Date:** 2026-06-20
**Epic:** EP-ONBOARDING-INTAKE · **BI:** BI-527E5C40
**Spec:** [`docs/superpowers/specs/2026-06-20-onboarding-intake-derivation-design.md`](../specs/2026-06-20-onboarding-intake-derivation-design.md) §5
**Status:** Implemented (this PR)

## Goal

Give org-wide **risk posture** a typed home (today `riskAppetite`/`riskTolerance`/`riskPosture` exist in zero files) and derive a conservative **default from industry**, mirroring `INDUSTRY_RETENTION_FLOORS`. Ship **dark/inert**: capture + derive + store only — no consumer reads it yet (that is P1).

## Design decisions

- **Home = `BusinessContext`** (kernel-consulted, no commandment conflict): the canonical 1:1 per-org business-profile model already seeded at onboarding and feeding WWWD. A new governance table would be a parallel doctrine home (violates single-source-of-truth); a Json blob violates strongly-typed-enums.
- **One stored knob + read-time envelope.** Store only `riskPosture` (+ source + capturedAt); `resolveRiskEnvelope()` maps posture → envelope at read time (no stored derivation to drift).
- **Industry can only raise caution.** `INDUSTRY_RISK_DEFAULTS` keys = the four regulated retention-floor industries → `conservative`; everything else → `balanced`. `progressive` is reachable only by explicit operator choice. Card-handling nudges balanced→conservative.
- **Envelope ≠ live level.** Posture sets the autonomy *ceiling + maturation rate*; the autopilot trust dial still starts HITL-first and earns autonomy on evidence (reconciles with the trust-dial-maturation doctrine).
- **Provenance protects intent.** The form sends `riskPosture` only when the operator actually changed it (→ `source="operator"`). An untouched default is left for setup completion to (re)derive against the archetype finally chosen (`source="industry-default"`), which the seed never overwrites once operator-set.

## Change set

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | `BusinessContext.riskPosture` / `riskPostureSource` / `riskPostureCapturedAt` (nullable String/String/DateTime) |
| `packages/db/prisma/migrations/20260620170000_add_business_context_risk_posture/migration.sql` | additive `ADD COLUMN` ×3 (no backfill — nullable) |
| `apps/web/lib/govern/risk-posture.ts` | **new** pure module: `RISK_POSTURES` enum, `deriveRiskPostureDefault()`, `resolveRiskEnvelope()`, guards. Reuses `toFloorKey` (shared industry normaliser) |
| `apps/web/lib/govern/risk-posture.test.ts` | **new** unit tests (derivation, aliases, card nudge, envelope, fail-open) |
| `apps/web/lib/onboarding/seed-risk-posture.ts` | **new** seed-once/idempotent default at setup completion; fail-open |
| `apps/web/lib/actions/setup-progress.ts` | call `seedRiskPosture()` in `finalizeSetupCompletion()` |
| `apps/web/app/api/business-context/setup/route.ts` | accept + validate + persist `riskPosture` (operator provenance); GET already returns it |
| `apps/web/components/admin/BusinessContextForm.tsx` | one plain 3-way control (canonical values, plain-language labels), edited-gated submit |
| `apps/web/app/(shell)/storefront/settings/business/page.tsx` | pre-set `initial.riskPosture` = stored ?? derived default |

## Inert guarantee

No runtime path imports `riskPosture` / `resolveRiskEnvelope` to change behaviour — the column is captured + seeded only. Existing BusinessContext upserts (storefront setup, etc.) leave the nullable field untouched. Verified by: `resolveRiskEnvelope` and the new column have no non-test importers outside this slice.

## Surface-refactoring note

Surfaces are in flux (operator-console / nav-coherence work). The only surface-coupled piece is the one form control; it is built on the existing inline-options + chip pattern (like `COMPANY_SIZE_OPTIONS`) and the canonical enum is decoupled from display labels, so the control relocates cleanly and the label wording is a trivial display tweak.

## Verification

- Unit: `vitest run apps/web/lib/govern/risk-posture.test.ts` (pure functions).
- Build/typecheck + migration apply: via the shared local-CI convergence sandbox / canonical install (worktree is source-control isolation, AGENTS.md §5).
- UX-fit: `UX-Fit-Decision` attestation in the PR (progressive disclosure; one plain choice, no numeric knob).

## Next (not this PR)

P1 (BI-E0E977BC) wires the envelope into the trust dial, `AgentGovernanceProfile` seed, self-upgrade window, capability auto-activation, outbound strictness, edge deploy.
