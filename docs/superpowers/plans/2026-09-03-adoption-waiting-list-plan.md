---
status: active
---
# Adoption waiting list — implementation plan

**Backlog:** BI-899D7F00 (retired duplicates: BI-5C3F3433, BI-336EEDF3, BI-C3B5FB75, BI-3A0F6E1F)
**Route:** `/storefront/animals/waiting`
**Status:** implemented on `feat/adoption-waiting-list`

## Why

The owner of a pet-rescue storefront asked five times in three days for one page listing the animals already listed for adoption, longest wait first, with the days each has waited, to choose animals for the newsletter. Each time Build Studio escalated the build and the item was parked with nothing attached (BI-9DA5F179), so the owner asked again. The last filing carries a decided-scope block; this plan honours it without re-opening any of it.

## Decided scope (owner)

- Staff-only behind the existing login. The storefront `(shell)` layout already gates on `view_storefront`, so a page under it inherits the protection.
- No pagination: the whole list on one page, capped at the 100 longest-waiting, stated at the bottom when the cap bites.
- A listing date in the future is a data-entry error: the animal is left out of the ordering (shown last, no day count), never a negative number.
- A missing listing date shows last rather than hiding the animal.
- Read-only. No new fields, models, settings, filters, configuration or export. The listing date is `AdoptableAnimal.publishedAt`.

## One judgement call

The request says "dogs and cats"; `species` also allows rabbit and other. Filtering to dog and cat could hide the animal that has waited longest, which is the failure the page exists to prevent. The page lists every animal with status `available` and shows species as a column.

## Deliverables, in order

1. `apps/web/lib/storefront/adoption-waiting-list.ts` — pure ordering (`buildWaitingList`, `wholeDaysWaiting`) with tests covering oldest-first, whole-day counts, future and missing dates, species inclusion, status gate, the cap and its notice, and stable tie-breaks.
2. `apps/web/app/(shell)/storefront/animals/waiting/page.tsx` — server page over the existing `StorefrontConfig` and `AdoptableAnimal` rows; lead band with the one next action; twenty-five rows open, the rest on the same page behind one disclosure so the detail shell's default-visible budget holds at 100 rows; empty state and no-storefront state. `page.test.tsx` renders it and audits the served markup against the detail-shell budget as a net-new route.
3. A "Waiting list" link beside the Adoptable animals heading in `AnimalsManager`, the page's entry point.
4. Page-purpose contract `apps/web/lib/ux-budget/purpose-contracts/adoption-waiting-list.ts`, registered in the index; route registries regenerated (`route:sync`, `build:page-purpose`).
5. Sweep fixture context: `ux-sweep-fixture-core.mjs` provisions one pet-rescue storefront on the seeded platform organisation with the animals-available section and four listed animals (two dated, one future-dated, one undated). This is the honest fixture context that lets the route be measured by the served-app sweep; sibling storefront routes keep their `storefront-setup-required` exclusion until each gets its own.
6. UX-Fit manifest `docs/ux-fit/2026-09-03-adoption-waiting-list.ux-fit.json` with `sweep-measurement` evidence taken from the CI route sweep run on this branch, not invented.

## Verification

- Unit: `pnpm --filter web exec vitest run lib/storefront/adoption-waiting-list.test.ts app/\(shell\)/storefront/animals/waiting/page.test.tsx lib/ux-budget`.
- Fixture self-test: `node --test apps/web/scripts/ux-sweep-fixture-core.test.mjs`.
- Served-app: the `ux-route-sweep` workflow on the branch measures `/storefront/animals/waiting`; the manifest carries those numbers.
- Live: after the self-upgrade deploys the merge, open `/storefront/animals/waiting` on the canonical install as staff and read the list against the Animals page.
