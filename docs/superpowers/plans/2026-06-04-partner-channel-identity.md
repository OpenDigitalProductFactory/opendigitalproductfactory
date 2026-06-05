# Implementation Plan — Partner / Reseller Channel & Identity

**Date:** 2026-06-04
**Spec:** [`docs/superpowers/specs/2026-06-04-partner-reseller-archetype-identity-design.md`](../specs/2026-06-04-partner-reseller-archetype-identity-design.md)
**Epic:** `EP-PARTNER-CHANNEL`
**Decision basis:** WWMD `principle_decide` (spec §7) — partner identity = `Principal.kind="partner"` + `partner_contact` alias; no parallel table.

This plan turns the reviewed spec into ordered, gate-aware phases. Each phase names the files to touch, the migration (if any), and **which verification substrate** the build gate runs on — because a source-only worktree can verify `@dpf/storefront-templates` (pure TS) but **cannot** run `apps/web` tests or Prisma migrations (verified 2026-06-04: `react-dom/server` does not resolve; no DB). Runtime-bound gates run on the **canonical local install** or a **shared local-CI convergence sandbox lease** per AGENTS.md §5.

## Status legend
`LANDED` merged to main · `OPEN-PR` pushed, in review · `TODO` not started.

---

## Phase 0 — Archetype partner primitives — `LANDED` (#1454)

`@dpf/storefront-templates`: `PartnerProgramProfile` (+ `PartnerType`/`PartnerTier`/`PartnerPortalMode`/`PartnerGraphMode`/`CapabilityActivationChoice`), `OwnershipScope+='partner-account'`, `CapabilityIsolation+='strict-partner-scope'`, `partner-program` capability, `derivePartnerProgramProfile`, `partner-channel-from-axes` rule, `NormalizedActivationProfile.partnerProgram`, and `resolveCapabilityActivation` (setup/add-later resolution). Pure TS; verified in-package.

## Phase 1 — Target archetype catalog wiring — `OPEN-PR` (#1457, partial)

- **Landed:** `wholesale-distribution` archetype (retail-goods) deriving `partner-program=available`; catalog-level tests; `it-managed-services` already derives it.
- **Remaining (TODO):**
  1. `software-platform` axes (`platform:"yes-developer"`). **Coordinate with `BI-ARCH-4C1E90`** (Archetype Model V2 owns software-platform defaults) per PAR — propose the axis block to that item rather than committing a competing `activationProfile` here. Gate: package vitest.
  2. Seed reconciliation + portal QA for `wholesale-distribution` on the **canonical install** — confirm the archetype upserts (`packages/db/src/seed-storefront-archetypes.ts` → `ARCHETYPE_SEED_DATA`) and renders in the setup picker. Gate: canonical install (UX).

## Phase 1b — Setup question + add-later (persisted org choice) — `TODO`

Delivers the founder requirement: **ask at setup, store the answer, allow adding later.** Generic across all `recommended`/`optional` capabilities; partner-program is the first consumer. Logic primitive (`resolveCapabilityActivation`) is already LANDED.

1. **Schema — `packages/db/prisma/schema.prisma`** (migration `add-organization-capability-activation`):
   ```prisma
   model OrganizationCapabilityActivation {
     id             String   @id @default(cuid())
     organizationId String
     capabilityKey  String   // matches @dpf/storefront-templates CapabilityKey
     choice         String   // CapabilityActivationChoice: "enabled" | "disabled"
     decidedAt      DateTime @default(now())
     decidedVia     String   // "setup-wizard" | "admin"
     organization   Organization @relation(fields: [organizationId], references: [id])
     @@unique([organizationId, capabilityKey])
     @@index([organizationId])
   }
   ```
   Create with `pnpm --filter @dpf/db exec prisma migrate dev --name add-organization-capability-activation`. **Gate: canonical/sandbox (migration apply).**
2. **Setup-prompt metadata — `@dpf/storefront-templates/capability-registry.ts`:** add optional `setupPrompt?: { question: string; helpText?: string }` to `CapabilityRegistryEntry`; set it on `partner-program` ("Do you sell through partners or resellers?"). Add `getCapabilitySetupPrompt(key)`. Gate: package vitest (verifiable in worktree).
3. **Effective-activation read path — `apps/web/lib/storefront/`:** a server helper that loads an org's `OrganizationCapabilityActivation` rows and folds them through `resolveCapabilityActivation(derivedApplicability, choice)` to produce the effective capability set the UI/routes consult. Gate: canonical (typecheck + unit).
4. **Setup wizard — `apps/web/components/storefront-admin/SetupWizard.tsx`:** for each capability where `resolveCapabilityActivation(...).promptAtSetup`, render the `setupPrompt` question; persist the answer to `OrganizationCapabilityActivation` (`decidedVia:"setup-wizard"`). Surface partner-program in `ArchetypeActivationSummary` (add `partner-program` to `SUMMARY_CAPABILITY_ORDER`; show the `partnerProgram` portal mode + partner types). Gate: canonical (UX).
5. **Admin add-later toggle — `apps/web/app/(shell)/storefront/settings/...`:** a capability toggle for `canEnableLater` capabilities (writes `decidedVia:"admin"`). Gate: canonical (UX).
6. **Archetype changeable post-setup:** add an API/action to update `StorefrontConfig.archetypeId` so applicability re-derives (today it is read-only). Gate: canonical (UX + ensure dependent capability rows reconcile).

## Phase 2 — Partner identity + partner-org account — `TODO`

1. **Schema audit decision (partner org):** choose `CustomerAccount.accountKind` discriminator vs a thin `PartnerAccount` vs explicit crosswalk (spec §6.2). Record the decision (WWMD `principle_decide` if non-obvious) before migrating. Bias: `PartnerAccount` if partner-specific fields (tier, agreement ref, margin policy, deal-registration ledger, partner graph) would pollute `CustomerAccount`.
2. **Migration:** add the chosen partner-org model + (if needed) `Principal.kind` is free-string so `"partner"` needs no enum migration; add a `PartnerAccountPrincipal`/membership row keyed by `(partnerAccountId, principalId)` for delegated admin. Gate: canonical/sandbox (migration apply).
3. **Principal linking — `apps/web/lib/identity/principal-linking.ts`:** add `syncPartnerPrincipal(partnerContactId)` mirroring `syncCustomerPrincipal`, kind `"partner"`, alias `partner_contact` (match the implemented snake_case alias vocabulary). Gate: canonical (unit).

## Phase 2a — Identity/auth approach checkpoint — `TODO`

Decide **identity-edge-first (OIDC via authentik) vs principal-local credentials** before writing a local Partner credentials provider, so Phase 3 doesn't build a throwaway. Reference the enterprise-auth spec's partner population. Output: a short ADR appended to the spec.

## Phase 3 — Partner login + `/partners` shell — `TODO`

1. **Auth — `apps/web/lib/govern/auth.ts`:** `UserType = "admin" | "customer" | "partner"`; Partner credentials provider mirroring the customer provider; session carries `partnerAccountId`, `partnerTier`, `partnerContactId`, and (moving toward convergence) `principalId`. Gate: canonical (auth flow UX).
2. **Authorization — `apps/web/lib/identity/effective-auth-context.ts`:** partner scope resolving on the `Principal`, gated to `partner-account` ownership with `strict-partner-scope`; a partner cannot read another partner's or the operator's internal records (scope-guard tests). Gate: canonical (unit + UX).
3. **Portal — `apps/web/app/partners/...`:** external partner workspace, gated by *active* `partner-program` (effective activation from Phase 1b), never raw `archetypeId`. Compose `report-kit` primitives (StatusBadge/DataTable/StatCard/FilterBar/ExportButton). First viewport: deal registrations, tier/agreement status, enablement, performance. Gate: canonical (UX).

## Phase 4 — Deal registration, tiering, delegated admin — `TODO`

Deal-registration ledger + partner tier records (prepared-not-prescribed — no payout/accounting execution yet); delegated partner-admin role (partner admin manages own contacts, partner-scoped); export paths with strict partner-account scope guards. Migration + canonical UX gates.

## Phase 5 — Partner federation + SCIM — `TODO`

OIDC/SAML against partner IdP + SCIM lifecycle as the partner-population projection of the authentik identity edge (enterprise-auth spec). No new auth stack. Canonical/sandbox gates.

---

## Ordering & dependencies

```
Phase 0 (done) ─┬─ Phase 1 (PR) ──────────────┐
                └─ Phase 1b (setup/add-later) ─┤
                                               ├─ Phase 3 (login/portal) ─ Phase 4 ─ Phase 5
            Phase 2 (identity) ─ Phase 2a ─────┘
```

- Phase 1b and Phase 2 are independent and can proceed in parallel; both block Phase 3.
- Phase 2a (auth approach) must precede the Phase 3 auth provider.
- Every `TODO` phase from 1b onward requires migration and/or `apps/web` runtime — run those build gates on the **canonical install** or a **`claim_nonprod_environment_lease(environmentKey="local-integration-ci")`** sandbox, not the worktree.

## Verification matrix

| Phase | Worktree-verifiable? | Build gate substrate |
| --- | --- | --- |
| 0, 1 (catalog), 1b step 2 (registry) | yes (`@dpf/storefront-templates` vitest + tsc) | package |
| 1 (seed/QA), 1b (model/wizard/admin), 2, 3, 4, 5 | no | canonical install / sandbox lease (migration + UX) |
