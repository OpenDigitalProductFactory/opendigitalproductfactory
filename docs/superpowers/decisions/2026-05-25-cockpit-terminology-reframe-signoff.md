# ADR: Cockpit Terminology Reframe Sign-off

**Date:** 2026-05-25
**Backlog item:** BI-19D40BE7
**Epic:** EP-REDUCTION-GEAR-ARCH
**Branch:** `codex/cockpit-terminology-reframe`
**Status:** Accepted for branch handoff

## Decision

Adopt a render-time install terminology layer for the Cockpit. GearInterface remains the canonical raw evidence stream, while the Cockpit resolves operator-facing nouns from `Organization`, `StorefrontConfig`, `StorefrontArchetype`, and named coworker sources when those sources are configured.

When required install context is incomplete, the Cockpit stays in abstract mode and shows an explicit banner instead of silently pretending to be install-aware.

## Evidence

Configured install:

- Runtime image: `dpf-cockpit-terminology-reframe:local`, served at `http://localhost:3010`.
- Live configured context: `Digital Product Factory`, `Software Platform` storefront archetype.
- GearInterface fixture/live coverage in the 30-day window: 21 rows, 3 slips, 3 human-graded rows, 3 graduation/veto rows, and Ring 2 to 3 data.
- Overview screenshot: `docs/superpowers/evidence/2026-05-25-cockpit-terminology-reframe/configured-overview-desktop.png`.
- Drill-down screenshot: `docs/superpowers/evidence/2026-05-25-cockpit-terminology-reframe/configured-drilldown-desktop.png`.
- Mobile overview screenshot: `docs/superpowers/evidence/2026-05-25-cockpit-terminology-reframe/configured-overview-mobile.png`.
- Mobile drill-down screenshot: `docs/superpowers/evidence/2026-05-25-cockpit-terminology-reframe/configured-drilldown-mobile.png`.

Fallback install:

- Scratch database: `dpf_cockpit_cold_verify`.
- True empty production-path database redirects to `/setup`, which is the platform shell's first-run guard before Cockpit is reachable.
- Reachable partial-config fallback state: organization present, no `StorefrontConfig`, no `StorefrontArchetype`; runtime image served at `http://127.0.0.1:3011`.
- Banner verified: `Install identity not configured - using abstract gear vocabulary.`
- Setup CTA verified: `Configure in Storefront setup`.
- Fallback screenshot: `docs/superpowers/evidence/2026-05-25-cockpit-terminology-reframe/partial-config-fallback-desktop.png`.
- Mobile fallback screenshot: `docs/superpowers/evidence/2026-05-25-cockpit-terminology-reframe/partial-config-fallback-mobile.png`.
- Empty cold setup guard screenshots: `docs/superpowers/evidence/2026-05-25-cockpit-terminology-reframe/cold-empty-setup-redirect-desktop.png` and `docs/superpowers/evidence/2026-05-25-cockpit-terminology-reframe/cold-empty-setup-redirect-mobile.png`.

Automated verification:

- `pnpm --filter web exec vitest run lib/cockpit/cockpit-formatting.test.ts lib/cockpit/install-terminology.test.ts` passed: 2 files, 9 tests.
- `pnpm --filter web typecheck` passed.
- `pnpm --filter web build` passed. Existing Turbopack Edge-runtime warnings appeared in unrelated platform/discovery/Prisma traces.
- `docker build --target runner -t dpf-cockpit-terminology-reframe:local .` passed.
- `git diff --check` passed, with only the existing Windows LF-to-CRLF warning for `apps/web/app/(shell)/admin/cockpit/page.tsx`.
- Hardcoded color scan across Cockpit files returned no matches for prohibited hardcoded Tailwind color classes or hex colors.

Drill-to-evidence proof:

- Overview metric links preserve `days`, `ring`, and `dir`.
- Verified URL: `/admin/cockpit?days=30&ring=1-2&dir=outward`.
- Recent transmissions header changes to `Filtered transmissions` and shows `Ring 1->2 Team -> Portal workflow - outward`.
- Rows show source evidence anchors as `shaftSourceType` plus `unknown source route: {shaftSourceId}` until source-specific routes land.

Spec review:

- A peer spec-document-reviewer pass returned `PASS` after revisions. It confirmed UX/ADR evidence, drill-down behavior, terminology sources, component scope, and research coverage were resolved.

## Consequences

- Cockpit copy is install-aware only when required context is present.
- GearInterface rows remain raw and do not store display names.
- Unknown coworker IDs remain visible for auditability instead of forcing page-level fallback.
- The Recent transmissions table is now a real first drill-down slice, not only an unfiltered recent event list.

## Follow-ons

- Phase 2 can replace `unknown source route` with source-specific links once those route contracts are available.
- Future Cockpit panels beyond overview and Recent transmissions should consume the same terminology layer before adding new copy.
- The platform shell's true empty-install redirect remains correct; any desire to preview Cockpit before first-run setup should be handled as a separate setup/shell policy change, not inside this BI.
