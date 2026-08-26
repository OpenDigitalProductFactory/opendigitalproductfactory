---
status: active
---

# Implementation Plan - Partner / Reseller Channel & Identity

**Date:** 2026-06-04
**Enterprise architecture review:** 2026-06-05
**Spec:** [`docs/superpowers/specs/2026-06-04-partner-reseller-archetype-identity-design.md`](../specs/2026-06-04-partner-reseller-archetype-identity-design.md)
**Epic:** `EP-PARTNER-CHANNEL`
**Decision basis:** WWMD `principle_decide` (spec §7) - partner identity = `Principal.kind="partner"` + `partner_contact` alias; no parallel partner identity table.

This plan turns the reviewed spec into ordered, gate-aware implementation slices. It is intentionally strict about current repo truth, identity convergence, UI quality, and verification substrate: source-local package work can run in the worktree, but `apps/web`, migrations, auth, and UX gates run on the canonical local install or a `claim_nonprod_environment_lease(environmentKey="local-integration-ci")` sandbox per AGENTS.md §5.

## Architecture Review Result

Aligned with concerns addressed. The core direction is sound: partner support derives from archetype axes; partner humans converge through `Principal` / `PrincipalAlias`; partner organizations are account/domain records; the portal reads effective capability activation instead of raw `archetypeId`. The original plan needed tightening in five places:

- Status drift: PR #1454 and PR #1457 are now merged, while the live backlog still has several captured items that need status/evidence cleanup.
- Phase 1b drift: setup-prompt metadata already exists in `@dpf/storefront-templates`; persistence and UI do not.
- Identity risk: a local Partner credentials provider must not clone `CustomerContact.passwordHash` before the identity-edge or generic principal-credential decision.
- UI under-specification: `/partners` needs an operational workbench contract, not just "use report-kit".
- Refactoring budget: at least 20 percent of the implementation effort stays reserved for shared primitives exposed by this feature.

## Live Planning Context

Live DPF MCP reads on 2026-06-05 UTC:

| Scope | Live state | Plan implication |
| --- | --- | --- |
| `EP-PARTNER-CHANNEL` | In progress; six captured items. | Keep this plan tied to the partner epic; do not create a parallel epic. |
| `BI-DE3FA72C` | Phase 0 partner primitives. | PR #1454 is merged; record/close after canonical evidence is attached. |
| `BI-D4C550E1` | Phase 1 target archetype wiring. | PR #1457 is merged for `wholesale-distribution`; software-platform and canonical setup QA remain. |
| `BI-66CF1AA4` | Phase 1b setup-time capability question + add-later toggle. | This is the next implementation slice. |
| `BI-DE47EC0B` | Phase 2 partner identity + partner-org account. | Keep schema audit and identity convergence explicit before migration. |
| `BI-00E69FBA` | Phase 3 partner login + `/partners` shell. | Blocked by Phase 1b and Phase 2/2a decisions. |
| `BI-C47A568C` | Phases 4-5 deal registration, tiering, delegated admin, federation, SCIM. | Later capability slices; do not pull payout/accounting into early phases. |
| `EP-ARCH-8D4F2A` / `BI-ARCH-4C1E90` | Archetype Model V2 owns setup/business-archetype unification and software-platform defaults. | Propose software-platform axes to that item instead of committing a competing activation profile here. |

MCP `search_specs_and_plans` returned no indexed partner/reseller matches for the searched terms, even though the linked local spec exists in this branch. Treat the local spec path above as the source of truth until indexing catches up.

## Current Repo Truth

| Area | Verified state | Constraint |
| --- | --- | --- |
| Partner primitives | `PartnerProgramProfile`, partner types/tiers/modes, `partner-account`, `strict-partner-scope`, `partner-program`, `derivePartnerProgramProfile`, `readActivationProfile(...).partnerProgram`, and `resolveCapabilityActivation` exist under `packages/storefront-templates/src`. | Do not reimplement derivation in `apps/web`; consume the package contract. |
| Setup prompt metadata | `CapabilityRegistryEntry.setupPrompt`, `partner-program` prompt copy, and `getCapabilitySetupPrompt()` already exist in `packages/storefront-templates/src/capability-registry.ts`. | Phase 1b should start from persistence and UI wiring, not repeat registry work. |
| Catalog wiring | `it-managed-services` derives `partner-program=available`. PR #1457 added `wholesale-distribution` with catalog tests. `software-platform` still needs axes through `BI-ARCH-4C1E90`. | Phase 1 is merged but incomplete as a product outcome until software-platform and canonical setup QA are done. |
| Setup UI | `SetupWizard` previews activation summaries and writes `StorefrontConfig` / `BusinessContext`; no org-level capability choice is persisted. | Add a generic org capability overlay shared by setup and admin. |
| Admin settings | `/storefront/settings`, `/storefront/settings/business`, and `/storefront/settings/operations` exist. | Add capability activation to the existing settings IA, not a disconnected partner-only settings page. |
| Auth/session | `apps/web/lib/govern/auth.ts` has `UserType = "admin" | "customer"` and workforce/customer credential providers. Session has customer account/contact fields but no partner fields and no canonical `principalId`. | Phase 3 must extend the session shape deliberately and preserve principal semantics. |
| Principal spine | `Principal` / `PrincipalAlias` are live tables with free-string `kind` / `aliasType`; implementation uses snake_case aliases such as `customer_contact`. | Use `partner_contact` unless an alias-kind normalization lands first. |
| Effective auth context | `apps/web/lib/identity/effective-auth-context.ts` currently resolves workforce/admin principal context only. | Partner-account scope needs a shared policy extension, not route-local checks. |
| Account model | `CustomerAccount` is CRM/customer-heavy and has no `accountKind`. | Partner org modeling requires a real schema audit before migration. |
| Report-kit | `StatusBadge`, `StatCard`, `DataTable`, `FilterBar`, `ExportButton`, `Chart`, and `statusColors` exist in `apps/web/components/ui/report-kit/`. | Partner reporting surfaces must extend report-kit/status intents instead of hand-rolling badges, KPI cards, tables, or color maps. |

## Non-Negotiable Invariants

1. **No raw archetype gating.** Feature code never checks `archetypeId === "software-platform"` to enable partners. It reads normalized partner-program applicability plus org activation.
2. **Generic activation overlay.** `OrganizationCapabilityActivation` (or an equivalent name chosen during migration) is keyed by `(organizationId, capabilityKey)`, not partner-specific.
3. **Principal convergence.** Partner humans are `Principal.kind="partner"` with a `PrincipalAlias.aliasType="partner_contact"`; no `PartnerContact` identity island.
4. **Partner org is account data.** Use `PartnerAccount`, `CustomerAccount.accountKind`, or an explicit crosswalk only after auditing CRM/customer coupling.
5. **No partner-only password table.** Decide identity-edge-first vs generic principal-local credentials before any local Partner credentials provider.
6. **Strict partner scope.** `partner-account` ownership and `strict-partner-scope` must be enforced server-side for list, detail, mutation, and export paths.
7. **Operational UI first.** `/partners` opens to work in progress: deal registrations, tier/agreement state, enablement, team, support, and performance. It is not a marketing landing page.
8. **Theme-aware/report-kit UI.** Use `var(--dpf-*)` tokens and report-kit primitives; add status intents centrally.
9. **Refactoring reserve.** Each implementation slice reserves at least 20 percent of effort for shared primitives: capability activation service, principal/session context, scope policy helpers, and report-kit/status intent coverage.

## Standards Anchors

Phase 5 federation/provisioning must follow standards, not vendor shorthand:

- OIDC: [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0-final.html). Bind external identities to issuer + subject, not email.
- SCIM: [RFC 7643](https://datatracker.ietf.org/doc/html/rfc7643) core schema and [RFC 7644](https://datatracker.ietf.org/doc/rfc7644/) protocol. Use SCIM users/groups and PATCH semantics for lifecycle and membership where applicable.
- SAML: [OASIS SAML 2.0 Technical Overview](https://docs.oasis-open.org/security/saml/Post2.0/sstc-saml-tech-overview-2.0.html). Treat SAML metadata/trust as identity-edge configuration, not DPF authorization policy.
- DPF identity edge: `docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md` keeps authentik as the protocol edge and DPF Authority Core as the authorization owner.

> **Superseded stance (2026-08-26, EP-24741BBF / `BI-5167932D`).** The enterprise-auth spec's choice to adopt authentik as a runtime identity edge has been **reversed**. DPF absorbs the directory over its own `Principal` spine and adds no IdP to any install. Consuming an external IdP as an *upstream* remains supported and optional. See [Directory Service — Identity Absorption Design](../specs/2026-08-23-directory-service-identity-absorption-design.md) and [the authentik evaluation](../../security/tool-evaluations/2026-08-23-authentik.md).

- DPF UI: `docs/platform-usability-standards.md` and `apps/web/components/ui/report-kit/README.md` are the binding UI references. `search_design_intelligence` returned no results for partner/dashboard/reporting queries during this review, so local standards govern.

## Phase 0 - Archetype Partner Primitives - MERGED (#1454)

**Backlog:** `BI-DE3FA72C`

Landed in [`#1454`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1454):

- `@dpf/storefront-templates` partner primitives: `PartnerProgramProfile`, partner type/tier/mode types, `CapabilityActivationChoice`.
- `OwnershipScope += "partner-account"` and `CapabilityIsolation += "strict-partner-scope"`.
- `partner-program` capability and `partner-channel-from-axes` rule.
- `derivePartnerProgramProfile` and `NormalizedActivationProfile.partnerProgram`.
- `resolveCapabilityActivation` for setup/add-later semantics.
- Source-local package tests.

Follow-up: update live backlog/evidence once canonical evidence for the merged work is recorded.

## Phase 1 - Target Archetype Catalog Wiring - MERGED PARTIAL (#1457)

**Backlog:** `BI-D4C550E1`

Landed in [`#1457`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1457):

- New `wholesale-distribution` retail-goods archetype deriving `partner-program=available` from goods/business axes.
- Catalog-level tests for partner derivation.
- `it-managed-services` remains covered by existing MSP axes.

Remaining:

1. `software-platform` axes: set `platform: "yes-developer"` through `BI-ARCH-4C1E90` / Archetype Model V2, not as a competing activation profile in this partner branch.
2. Seed reconciliation: confirm `packages/db/src/seed-storefront-archetypes.ts` upserts the new archetype into `StorefrontArchetype`.
3. Canonical setup UX: verify `wholesale-distribution` appears in the setup picker and previews the partner-program summary on the canonical install or sandbox lease.

Source-local gate: package vitest/tsc for the template package.
Runtime gate: canonical install or shared local-CI sandbox for seed + setup UX.

## Phase 1b - Setup Question + Add-Later Capability Activation - NEXT

**Backlog:** `BI-66CF1AA4`

Delivers the founder requirement: ask at setup, store the answer, allow adding later. This is generic across all `recommended` / `optional` capabilities; `partner-program` is the first consumer.

### 1b.0 Refactor Checkpoint

Before adding UI behavior, create/extend shared primitives so partner-program does not become a special case:

- `apps/web/lib/storefront/effective-capability-activation.ts` (or equivalent): load derived capability applicability + org choices and return effective capability activation rows.
- A pure mapper that converts `CapabilityActivationResolution` into UI-ready labels, status intent, prompt visibility, and admin toggle availability.
- A central server action/API helper for writing capability choices with audit metadata.
- Report-kit/status intent additions for capability status (`required`, `recommended`, `enabled`, `disabled`, `not-applicable`) if the settings UI needs badges.

This checkpoint is the first 20 percent refactoring reserve for the slice.

### 1b.1 Schema

Add a generic org-capability overlay in `packages/db/prisma/schema.prisma` with migration `add-organization-capability-activation`:

```prisma
model OrganizationCapabilityActivation {
  id                   String   @id @default(cuid())
  organizationId       String
  capabilityKey        String
  choice               String
  decidedVia           String
  decidedByPrincipalId String?
  decidedAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  organization         Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  decidedByPrincipal   Principal?   @relation(fields: [decidedByPrincipalId], references: [id], onDelete: SetNull)

  @@unique([organizationId, capabilityKey])
  @@index([organizationId])
  @@index([decidedByPrincipalId])
}
```

Field rules:

- `capabilityKey` matches `@dpf/storefront-templates` `CapabilityKey`.
- `choice` is `CapabilityActivationChoice`: `enabled | disabled`.
- `decidedVia` starts with `setup-wizard | admin`; keep this a typed string in app code.
- `decidedByPrincipalId` is preferred over `userId` so the table is convergence-ready.
- If Prisma relation naming collides with existing `Principal` relations, name the relation during implementation; do not drop the principal audit link.

Create with `pnpm --filter @dpf/db exec prisma migrate dev --name add-organization-capability-activation`.
Gate: canonical install or sandbox lease migration apply.

### 1b.2 Registry Metadata - DONE IN BRANCH

Already present:

- `CapabilityRegistryEntry.setupPrompt`.
- `partner-program` prompt: "Do you sell through partners or resellers?"
- `getCapabilitySetupPrompt(key)`.
- Registry tests.

Do not re-add this. Only extend tests if the UI/API needs a new exported helper.

### 1b.3 Effective Activation Read Path

Add a server-side read path that:

1. Loads the active org's `StorefrontConfig -> StorefrontArchetype.activationProfile`.
2. Calls `readActivationProfile` / capability derivation from `@dpf/storefront-templates`.
3. Loads `OrganizationCapabilityActivation` rows for the org.
4. Resolves each capability through `resolveCapabilityActivation(applicability, choice)`.
5. Returns a typed list used by setup, admin settings, and route guards.

Rules:

- Effective activation is the only input to `/partners` gating.
- Unknown/stale capability keys are ignored but logged for cleanup.
- A missing org choice is different from an explicit `disabled` choice.
- Required capabilities may be confirmed/disabled only if the business rule allows it; the resolver remains the source of truth.

Gate: source-local unit tests for pure helper; canonical `web` typecheck/build gate when app code is wired.

### 1b.4 Setup Wizard

Update `apps/web/components/storefront-admin/SetupWizard.tsx` and `/api/storefront/admin/setup` so:

- The preview step renders setup prompts only for capabilities where `promptAtSetup === true` and `setupPrompt` exists.
- The partner prompt answer persists to `OrganizationCapabilityActivation` with `decidedVia: "setup-wizard"`.
- `ArchetypeActivationSummary` includes `partner-program` in `SUMMARY_CAPABILITY_ORDER` and shows partner portal mode / partner types without exposing raw JSON.
- The form stays progressive: ask the yes/no partner question in setup; defer partner types, tiers, deal-registration rules, and federation to admin.
- Copy says the capability can be added later when `canEnableLater === true`.

UX gate: canonical install or sandbox lease, authenticated as `admin@dpf.local`, setup picker -> preview -> submit path.

### 1b.5 Admin Add-Later Toggle

Use the existing `/storefront/settings` IA:

- Add a "Capabilities" section to `/storefront/settings` or `/storefront/settings/business` rather than a partner-only settings island.
- Show capability status with report-kit primitives if status badges/tables are used.
- Write through the same server action/API as setup with `decidedVia: "admin"`.
- Require active org + admin session; record `decidedByPrincipalId` when available.
- Do not show toggles for `not-applicable` / `hidden` capabilities.

UX gate: canonical install or sandbox lease, settings path with partner-program off -> enable -> `/partners` route becomes available.

### 1b.6 Archetype Change / Re-Derivation

Current repo has reset helpers but not a polished operator-facing post-setup archetype-change workflow. For this slice:

- Do not block partner add-later on a broad archetype migration UI.
- Add the minimum re-derivation hook needed so when the active archetype changes, effective capability state recalculates from axes + stored org choices.
- If a capability becomes `not-applicable`, leave the stored choice for audit but do not activate the route.
- File a separate follow-up if full archetype-change UX is larger than the partner activation slice.

## Phase 2 - Partner Account + Membership

**Backlog:** `BI-DE47EC0B`

Run the schema audit before choosing the partner-org model.

Decision options:

| Option | Use when | Watch-out |
| --- | --- | --- |
| `CustomerAccount.accountKind` | Partner accounts truly behave like CRM/customer accounts and share the same lifecycle safely. | Customer relations, invoices, customer sites, and opportunities may become semantically ambiguous. |
| Thin `PartnerAccount` | Partner-specific tier, agreement, margin, deal-registration policy, delegated admin, or partner graph fields would pollute `CustomerAccount`. | Requires explicit crosswalk if the same company is also a customer. |
| Explicit crosswalk | Same external org can be both customer and partner. | Do not merge by name/email; model the relationship. |

Likely implementation shape if `PartnerAccount` is chosen:

- `PartnerAccount` for partner org/program attributes.
- `PartnerAccountMembership` (or `PartnerAccountPrincipal`) keyed by `(partnerAccountId, principalId)` with partner role/admin flags.
- Optional crosswalk table between `PartnerAccount` and `CustomerAccount` for companies that are both.
- No credential fields on partner account or membership rows.

Gate: migration apply on canonical install/sandbox; schema tests for uniqueness and cascade behavior.

## Phase 2a - Identity/Auth Approach Checkpoint

This checkpoint must land before Phase 3 auth code.

Decision: identity-edge-first vs generic principal-local credentials.

Preferred direction:

- If authentik/OIDC can be used for the partner population now, implement partner login through the identity edge.
- If local credentials are unavoidable for an interim slice, first add a generic principal-local credential substrate that can later serve workforce/customer/partner, instead of adding `PartnerContact.passwordHash`.

Required outputs:

- Short ADR appended to the linked spec or a dedicated ADR file.
- Chosen credential source and migration impact.
- Session contract for `principalId`, `partnerAccountId`, `partnerMembershipId`, `partnerRole`, and `partnerTier`.
- Alias helper in `apps/web/lib/identity/principal-linking.ts`: `syncPartnerPrincipal(...)` using `aliasType: "partner_contact"` unless alias-kind normalization lands first.
- Tests mirroring `syncCustomerPrincipal` coverage.

## Phase 3 - Partner Login + `/partners` Workbench

**Backlog:** `BI-00E69FBA`

Blocks: Phase 1b effective activation + Phase 2/2a identity/account decisions.

### Auth And Session

- Extend `UserType` to include `"partner"`.
- Session carries canonical `principalId` and partner-specific fields.
- Partner auth resolves to `Principal`, not directly to a domain contact row.
- Social/OIDC account binding uses issuer + subject for federated identities, not email.

### Authorization

- Extend `apps/web/lib/identity/effective-auth-context.ts` for partner-account scope.
- Add reusable server-side scope guards for list/detail/mutation/export.
- Tests must cover cross-partner denial and operator-internal denial.
- Partner admin is a partner-scoped role, not a platform role.

### Route And UI Contract

Route: `apps/web/app/partners/...`

Gating:

- Active session `type === "partner"`.
- Effective `partner-program` activation is active for the operator org.
- Partner membership is active.

First viewport:

- `StatCard`: open registrations, expiring registrations, tier/agreement state, onboarding completion.
- Primary command: register deal.
- Recent deal registrations table: `DataTable`, `StatusBadge`, `FilterBar`, CSV export when useful.
- Enablement/next-action strip.
- Team/admin entry when the signed-in partner has delegated admin rights.

Tabs/subroutes:

- Home
- Deal Registrations
- Enablement
- Performance
- Team
- Settings

UI rules:

- No hero section, no marketing copy as the first screen.
- No nested cards or hardcoded colors.
- Use `StatusBadge` + central `statusColors` for deal/tier/agreement statuses.
- Use `Chart` only for meaningful time-series performance, imported by subpath.
- Empty states point to the next action.
- No workforce nav or operator-only shortcuts.

UX gate: canonical install or sandbox lease with a seeded partner account and one negative cross-partner test path.

## Phase 4 - Deal Registration, Tiering, Delegated Admin

**Backlog:** `BI-C47A568C`

Prepared-not-prescribed channel operations:

- Deal-registration ledger: status, owner partner account, expiry/renewal, conflict decision, audit notes.
- Partner tier/program records: tier, agreement reference, entitlement flags, review cadence.
- Delegated partner admin: invite/manage own partner members only.
- Export/reporting paths with strict partner-account scope.

Non-goals remain: payout execution, accounting sync, MDF, LMS, co-branded asset studios.

Gate: migration apply, scope-guard tests, canonical UX.

## Phase 5 - Partner Federation + SCIM

**Backlog:** `BI-C47A568C`

Federation is the partner-population projection of the enterprise-auth identity edge, not a new auth stack.

- OIDC: bind issuer + subject to `PrincipalAlias`, surface provider/account metadata only as alias/protocol details.
- SAML: configure trust/metadata at the identity edge; DPF consumes resolved principal context.
- SCIM: provision users/groups/memberships into partner account membership through standards-compliant lifecycle flows.
- DPF Authority Core owns roles, capabilities, partner scope, and audit semantics after authentication.

Gate: canonical/sandbox auth flow, provisioning lifecycle tests, partner deprovisioning denial path.

## Ordering And Dependencies

```text
Phase 0 merged
  -> Phase 1 merged partial
  -> Phase 1b setup/add-later
       -> Phase 3 /partners route gating

Phase 2 account/membership
  -> Phase 2a auth approach checkpoint
       -> Phase 3 partner login
            -> Phase 4 deal/tier/admin
                 -> Phase 5 federation/SCIM
```

- Phase 1b and Phase 2 can proceed in parallel.
- Phase 3 cannot start until Phase 1b effective activation and Phase 2/2a identity/account decisions are complete.
- Phase 4 can design records while Phase 3 runs, but cannot ship exports/mutations without partner scope guards.
- Phase 5 waits for the identity-edge ADR and partner membership model.

## Verification Matrix

| Work | Worktree-verifiable? | Required substrate |
| --- | --- | --- |
| `@dpf/storefront-templates` pure rules/tests | Yes | Worktree package tests/typecheck |
| Prisma migration creation | Partially | Generate in worktree; apply on canonical install or sandbox |
| `apps/web` typecheck/build | No for source-only worktrees | Canonical local install or shared local-CI sandbox |
| Setup wizard/admin settings UX | No | Canonical local install or shared local-CI sandbox |
| Auth/login/session UX | No | Canonical local install or shared local-CI sandbox |
| `/partners` UI and scope guards | Unit pieces source-local; UX runtime-bound | Source-local tests plus canonical/sandbox UX |

Report the substrate every time. A worktree-only package test is not canonical-runtime evidence for migrations, `apps/web`, auth, or UX.

## Completion Checklist

- [ ] Phase 0 and Phase 1 merged work has backlog status/evidence reconciled.
- [ ] `BI-66CF1AA4` implements generic org capability activation, not partner-only activation.
- [ ] Setup wizard asks the partner question only when resolved activation says to ask.
- [ ] Admin settings can enable partner-program later using the same resolver/write path.
- [ ] `/partners` is gated by effective activation, partner session, and active partner membership.
- [ ] Partner account schema audit is recorded before migration.
- [ ] Auth ADR chooses identity edge or generic principal-local credentials before Partner credentials provider work.
- [ ] Partner aliases use `partner_contact` unless alias-kind normalization lands first.
- [ ] Partner UI uses report-kit, theme tokens, and operational workbench IA.
- [ ] Canonical/sandbox verification evidence is captured for migration, build, setup UX, auth UX, and `/partners` UX.
