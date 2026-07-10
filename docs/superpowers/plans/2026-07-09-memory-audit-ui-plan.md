# Coworker memory transparency / audit UI — implementation plan

- **BI:** BI-DC8B03AB (EP-8C706944 — AI Coworker Memory & Context Architecture, Phase 4)
- **Date:** 2026-07-09
- **Kernel ledger:** DI-F69AE978B70C (program); **UX-fit ledger DI-94083410B6F1** (high confidence)
- **Status:** Server actions + self-serve page + admin section (this PR)

## Problem

No surface showed a human what a coworker remembers about them, and there was no per-item delete — the trust lesson from Cursor shipping then retracting invisible auto-memory, and the standard ChatGPT/Grok/Copilot memory-manager pattern. With two-scope memory (BI-1772D0B7) now tagging facts org/user + sensitive, transparency is a requirement, not a nicety.

## UX-fit decision (§12 gate)

`principle_decide` on `human_cognitive_load` (ledger **DI-94083410B6F1**, high confidence, margin 1.96) chose **self-serve settings panel + admin section** over a power "Memory console" or chat-only. Progressive disclosure: 3–5 plain category groups, sensitive items badged, scope shown as "Just you" / "Your team", no raw token/config inputs. `UX-Fit-Decision` trailer on the PR.

## Design

1. **Pure shaping** `memory-audit-shape.ts`: `groupAuditRows` (by category, display order, newest-first), `toAuditRow` (plain labels, scope/sensitivity, humanized provenance — no raw enum ids), `summarizeAudit` (total / org-shared / sensitive). 7 unit tests.
2. **Server actions** `memory-audit.ts` (`"use server"`): `loadMyMemoryAudit` (the caller's active facts, `requireUserId`), `forgetMyFact` (ownership-scoped **supersede, never a hard delete** — provenance survives), `loadOrgMemoryAudit` (`requireCapability("manage_agents")` — org-shared non-sensitive facts + coworker working notes, read-only).
3. **Page** `(shell)/platform/ai/memory/page.tsx` (server component): StatCards + per-category report-kit `DataTable`s of the caller's memories with a per-item **Forget** (themed `confirmDialog`, never `window.confirm` — §12); admins additionally see the org section. Route manifest regenerated (`build-route-manifest.ts`).

## Non-goals (follow-ups)

- Nav entry: the peer `/platform/ai/browser-sessions` route is likewise not nav-linked; nav-linking (and the nav-teleport gate) is a follow-up so this PR doesn't couple to nav registration. Route is reachable by URL.
- Correcting (vs forgetting) a fact inline — Forget + re-state via chat covers it for now.
- Org-scoped briefing display — composes with BI-A9052DCB's reserved `scope="org"`.

## Verification

- Unit: `memory-audit-shape.test.ts` (7 — humanize/label, row mapping, grouping order, unknown-category append, summary counts).
- Guards: Native Dialog Guard (uses `confirmDialog`), no-hardcoded-colors (all `var(--dpf-*)`), UX-Fit Gate (trailer present).
- Runtime (post-merge): a user opens the page, sees grouped memories with scope/sensitivity badges, clicks Forget → confirmDialog → the fact supersedes and disappears on refresh; an admin sees the org section, a non-admin does not.
