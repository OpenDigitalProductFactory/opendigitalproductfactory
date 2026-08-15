# Live-install hardening sweep — 2026-08-12

Batched fixes surfaced by exercising the platform on the live install.
One branch (`fix/live-install-hardening-sweep`), five backlog items. Each item was
substrate-verified first; two were found substantially pre-built and scoped down
to the genuine residual gap.

## BI-4150F4D6 (P1) — Human Principal not synced across identity-creation paths

**Source of truth:** `apps/web/lib/identity/principal-linking.ts` (the idempotent
`syncEmployeePrincipal` / `syncUserPrincipal` helpers) + the established backfill
migrations (`20260426150500_backfill_missing_principals`,
`20260729125500_backfill_owner_principal_internal_clearance`).

**Root cause:** the April 2026 backfill is forward-only and ran once, so humans
created afterwards through paths that omit principal sync end up
identity-incomplete. Fix converges the three omitting paths on the reference
path's behaviour and ships a fresh idempotent backfill for already-stranded rows.

- Admin `createUserAccount` → `syncUserPrincipal` (best-effort, logged).
- First-login EmployeeProfile auto-provision (`(shell)/layout.tsx`) → `syncEmployeePrincipal`.
- MCP `create_employee` (`workforce-pack.ts`) → `syncEmployeePrincipal`.
- New migration `20260812110000_backfill_missing_human_principals` (Users + Employees + superuser clearance floor), mirroring the runtime helpers.
- Regression tests in `workforce-pack.test.ts` and `users.test.ts`.

## BI-654EE2E9 (P1) — AI routing selects insufficient local tier

**Source of truth:** `apps/web/lib/routing/pipeline-v2.ts` (`routeEndpointV2`, the
LIVE pipeline for coworker + identity inference; `task-router.ts` is legacy for
these paths). When every provider is free, cost-per-success ranking collapses to
`successProb` and never reads `qualityTier`.

**Decision (governance-preserving):** add a quality-tier preference in Stage 5b
as a SECONDARY key under the existing provider-tier preference, engaging only
among free endpoints. This never routes around a sensitivity-clearance or
capability exclusion — deliberately NOT auto-bypassing governance gates, because
the live `fellToLocal` case is a clearance-config matter, not a ranking bug.
Regression tests in `pipeline-v2.test.ts`.

## BI-0D1FF269 (P2) — org base-currency/locale

**Substrate finding:** `OrgSettings.baseCurrency/locale/countryCode`,
`resolveOrgLocale`, `formatMoney`, and the `/finance/settings/currency` operator
surface ALREADY exist (EP-ORG-LOCALE-CURRENCY / BI-0530BB74). The detection BI's
"no field / no surface" premise was inaccurate. Residual gap: new records fell
back to a static `@default("USD")` rather than the org's configured base
currency. Fix defaults the three CRM create paths (account, opportunity, quote)
off `resolveOrgLocale(prisma).currency`; a quote inherits its opportunity's
currency first. Regression test in `crm-commercial.test.ts`.

## BI-15AC1B33 (P2) — CRM account edit/status/delete + record void

**Source of truth:** `apps/web/lib/actions/crm.ts` (governed by
`requireCapability("operate_customer")`) and the account detail page
`(shell)/customer/(crm)/[id]/page.tsx`. Prior surface exposed only "Merge into…".

New governed, audited server actions: `updateCustomerAccount` (fields + status),
`archiveCustomerAccount` (soft-delete via the reserved `archived` status, added
to `EXCLUDE_TOMBSTONED`), `removeOpportunity` (FK-safe guarded delete), and
`cancelSubscription`. Quote void reuses the existing `rejectQuote`. UI: progressive
disclosure — `AccountAdminActions` (Edit/Archive), inline `RemoveOpportunityButton`,
and a Cancel control on the contract card (`AccountLifecycleActions`). UX-fit
manifest: `docs/ux-fit/2026-08-12-crm-account-hygiene.ux-fit.json` (DI-85DDEEE554CF).

## BI-63FF58D2 (P4) — persistent "Monitoring offline" false state

**Source of truth:** `apps/web/lib/observability/alert-sources.ts` (the alert
source contract) and the operator chrome `PlatformHealthIndicator`. New
single-source `isMonitoringConfigured()` / `isPrometheusConfigured()` distinguishes
"no monitoring configured on this topology" (neutral) from "configured but
unreachable" (offline). The alerts route returns a `not-configured` state; the
indicator renders a neutral "Monitoring not configured"; the hourly poll
short-circuits and records `not-configured` instead of erroring. Regression tests
in `alert-sources.test.ts` and `discovery-scheduler.test.ts`.
