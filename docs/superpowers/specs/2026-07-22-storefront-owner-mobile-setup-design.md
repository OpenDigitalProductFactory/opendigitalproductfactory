# Storefront owner mobile setup — team/schedule + setup file inputs (390px)

- **Backlog item:** BI-F0B389C9 — "Storefront owner mobile setup needs tap-safe responsive controls"
- **Epic:** EP-UX-COGLOAD — Live UX cognitive-load audit follow-up
- **Status:** implemented
- **Date:** 2026-07-22

## Problem

The 390x844 owner-mobile audit found Storefront setup unusable for a
non-technical owner: sub-44px controls, terse/anonymous mutation buttons, and
unlabeled inputs. BI-F0B389C9 is broad; several concurrent EP-UX-COGLOAD PRs
carve it into non-overlapping slices. This PR owns the **team/provider +
schedule** controls and the **setup file inputs** — the part no sibling PR
touches.

## Scope & overlap (concurrent EP-UX-COGLOAD PRs)

Deliberately file-disjoint from the siblings so nothing collides at merge:

- Operating hours / items / sections tap-targets + labels → **#3395**
  (`OperatingHoursEditor`, `ItemsManager`, `SectionsManager`).
- Common shell / nav collapse + `apps/web/app/globals.css` + usability
  standards → **#3392**.
- `/ops/self-upgrade` owner card (BI-8D87084D) → **#3391**.
- `StorefrontInbox` booking handoff (BI-3DA1DFDC) → **#3387**; service-line
  recovery + `/storefront` setup (BI-C39DC90C) → **#3389**; public restaurant
  390px (BI-2B2FCB2B) → **#3390**; form-field contract (BI-8E74C749) → **#3386**.

Because the shared `.dpf-tap-target` utility would collide with #3392's
`globals.css` ownership, this PR applies the 44px minimum with **inline**
`min-h-[44px] min-w-[44px]` utilities (the same pattern #3395 uses), so it shares
no file with any open PR.

## Design grounding

- **Specs/plans reviewed:** `docs/superpowers/specs/` EP-UX-COGLOAD, and the live
  open-PR set (swept via `gh pr list --json files`) to carve a disjoint slice.
- **Code substrate reviewed (`apps/web/`):**
  `apps/web/components/storefront-admin/{TeamManager,ScheduleEditor}.tsx`,
  `apps/web/components/admin/{BusinessDocumentUpload,RosterImport}.tsx`,
  `apps/web/tailwind.config.ts` (colors only). Colors stay on `--dpf-*` tokens
  (AGENTS.md §12); the `confirmDialog` primitive is unchanged.
- **Decision:** extend the components in place with inline tap utilities.

## Approach

1. **TeamManager** — `+ Add Provider` / `Save Details` / `Delete Provider` get
   row-specific accessible names (`Delete provider ${p.name}`, `Save details for
   ${p.name}`, `Add a new ${teamLabel}`) and the 44px minimum.
2. **ScheduleEditor** — weekly and exception time inputs get outcome/context
   `aria-label`s (`${day} opening time` / `closing time`, `Exception opening
   time`), the exception type select + date + reason inputs get labels, the
   Remove/Add/Save controls get labels + 44px, and the weekly row `flex-wrap`s so
   it never clips at 390px. The day checkbox is wrapped in its `<label>`.
3. **BusinessDocumentUpload / RosterImport** — the file inputs are associated via
   `<label htmlFor>` + `id` and carry an outcome `aria-label` (`Upload a business
   plan or key document`, `Upload a team spreadsheet`).
4. **Playwright** — a `mobile-390` project (390x844, seeded-admin auth) runs
   `e2e/storefront-owner-mobile.spec.ts`: no horizontal overflow on
   `/storefront/team`, the add-provider control labelled + ≥44px, and every
   setup file input labelled. Assertions stay scoped to controls this PR sizes so
   the smoke does not depend on a sibling PR merging first.

## Acceptance mapping (BI-F0B389C9 — this slice)

- 44px tap targets on team/schedule controls — inline `min-h/min-w-[44px]`;
  Playwright asserts the add-provider control ≥44px.
- Row-specific labels replacing terse team/schedule buttons — `aria-label`s.
- Time inputs labelled by owner outcome (schedule) — `aria-label`s.
- File/select inputs labelled by owner outcome — file-input `<label>` + labels
  on the exception select.
- No overflow on the team route — weekly-row `flex-wrap`; Playwright asserts it.
