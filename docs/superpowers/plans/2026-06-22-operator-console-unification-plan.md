# Operator Console Unification — Implementation Plan (EP-NAV-COHERENCE P1 / BI-CB07C8BA)

| Field | Value |
| --- | --- |
| Status | Ready to implement (awaiting founder go — large user-facing change, wants live UX verification) |
| Date | 2026-06-22 |
| Spec | [`docs/superpowers/specs/2026-06-21-portal-navigation-coherence-operator-console-design.md`](../specs/2026-06-21-portal-navigation-coherence-operator-console-design.md) (§ "The operator console") |
| BI | BI-CB07C8BA (P1) |
| Depends on | P0 keystone (merged #2234 — Core Admin teleport already removed; breadcrumb live) |

## Goal

Make `/platform` and `/admin` **one operator console with a single secondary-nav model**, so crossing the boundary changes only the *active family*, never the whole tab row — completing the cure for founder complaint #1 (the keystone removed the teleport + added the breadcrumb; this removes the remaining context-swap).

## Key enabling fact

`apps/web/components/platform/PlatformTabNav.tsx` and `apps/web/components/admin/AdminTabNav.tsx` are **near-identical**: both render `families → tab row + the active family's subItems`. They differ only in (a) the data array (`PLATFORM_FAMILIES` / `ADMIN_FAMILIES`) and (b) the active-family resolver (`getPlatformFamily` / `getAdminFamily`). So the merge is a data-model union + one shared component, not a UI rewrite.

## Target model

One `CONSOLE_FAMILIES` (6 families — sub-row shown only for the active family, so the top row stays short):

| Family | href | subItems (source) |
| --- | --- | --- |
| Overview | `/platform` | Platform Hub, Schedule, Workbooks |
| Identity & Access | `/platform/identity` | (current platform identity subItems) |
| AI Operations | `/platform/ai` | (current platform ai subItems) |
| Tools & Services | `/platform/tools` | (current platform tools subItems) |
| Governance & Audit | `/platform/audit` | (current platform audit subItems) |
| Administration | `/admin` | Users & Roles (`/admin`), Branding, Settings, Reference Data, Business Models, Platform Development, Hive, Issue Reports, Diagnostics, Backups, Scheduled Jobs (the current `ADMIN_FAMILIES` subItems, flattened) |

`getConsoleFamily(pathname)`: `/admin*` → administration; `/platform/identity*` → identity; `/platform/ai*` → ai; `/platform/tools*` → tools; `/platform/audit*` → audit; `/platform` → overview.

(The **Runtime & Releases** family — self-upgrade / promotions / changes / dev-loop — is added in P2 alongside re-homing those routes off `/ops`; keeping it out of P1 avoids a mini context-swap, since those routes still render `OpsTabNav` until P2.)

## Steps

1. **`apps/web/components/console/console-nav.ts`** (new) — `CONSOLE_FAMILIES` + `ConsoleFamily` type + `getConsoleFamily(pathname)`. Compose the existing `PLATFORM_FAMILIES` (minus the already-removed Core Admin) and fold `ADMIN_FAMILIES` into the single `Administration` family. Reuse `BUILD_STUDIO_CONFIG_ROUTE_COPY`.
2. **`apps/web/components/console/ConsoleTabNav.tsx`** (new) — the shared render (lift the identical body of `PlatformTabNav`/`AdminTabNav`, drive it from `CONSOLE_FAMILIES`/`getConsoleFamily`). Preserve the `operations-map` compact-chrome branch from `PlatformTabNav`.
3. **Inject at layout level for both trees:**
   - Replace `<PlatformTabNav/>` with `<ConsoleTabNav/>` in `platform/ai/layout.tsx`, `platform/tools/layout.tsx`, `platform/audit/layout.tsx`, `platform/identity/layout.tsx`, and the manual import in `platform/page.tsx`.
   - Add `<ConsoleTabNav/>` to `app/(shell)/admin/layout.tsx` (currently a bare permission gate) and **remove the per-page `<AdminTabNav/>`** from `admin/page.tsx` (and any other admin page that imports it).
4. **Retire** `PlatformTabNav.tsx` + `platform-nav.ts` + `AdminTabNav.tsx` + `admin-nav.ts` (or re-export from `console-nav` during a deprecation window). Update imports.
5. **Canonical model alignment** (`portal-navigation-model.ts`): give `/admin` the console's `sectionSiblings` so the breadcrumb + nav-surface treat Administration as a console family (keep `domain: "admin"` for permissions; the console is the *experience* grouping). Keep `view_admin` gating unchanged.
6. **Tests:** port `platform-nav.test.ts` + `admin-nav.test.ts` → `console-nav.test.ts` (family set, `getConsoleFamily` routing for `/platform/*` and `/admin/*`, no family href leaves `/platform` or `/admin`). Update `PlatformTabNav.test.tsx`/`AdminTabNav.test.tsx` → `ConsoleTabNav.test.tsx`. Update `portal-navigation-model.test.ts` expectations. The **P7 inventory gate stays green** (still zero teleports — Administration is a console family, not a cross-domain entry).

## Verification

- **CI (from worktree):** typecheck + the ported unit tests + production build.
- **Live UX (the real gate, post-deploy):** after merge + self-upgrade deploy, drive the live portal (Claude-in-Chrome) — from `/platform` click into each family and into Administration, confirm the **tab row persists** (only the active family + sub-row change), the breadcrumb tracks, and there is no full-context swap. Verify on desktop + mobile width. This is the gate that can only run on the live install (the source-only worktree cannot host the runtime).

## Risks & rollback

- **Blast radius:** 5 platform layouts + admin layout/pages + 4 nav modules. Mitigated by the near-identical components (mechanical) and layout-level injection (one render point per tree). Each touched route is independently testable.
- **Admin sub-row length:** Administration has ~11 subItems. If too long, split into two families (e.g. Access & Org / Configuration & Advanced) — a 7-family console row is still fine.
- **Rollback:** the change is nav-only (no routes/permissions/data touched); revert the PR. Routes remain reachable via the persistent rail throughout.
