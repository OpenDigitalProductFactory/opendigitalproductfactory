# Restaurant owner service-readiness cockpit — plan

Design: [`2026-07-22-restaurant-owner-service-readiness-cockpit-design.md`](../specs/2026-07-22-restaurant-owner-service-readiness-cockpit-design.md)

## Backlog coverage

| Deliverable | BI | Notes |
| --- | --- | --- |
| Pure readiness read-model + one-next-action | BI-075F731F | Owner cockpit core answer |
| Cockpit component + `/storefront` mount | BI-075F731F, BI-353610C6 | Owner-readable, Simple-mode, tap-safe |
| Cockpit finance-exception + staffing-readiness read signals | BI-3326DA86, BI-001FD798 | Surfaced in the cockpit + drill-down links (not a page reframe) |
| Simple-mode body reduction on the cockpit | BI-353610C6 | Reads `nav-mode` cookie |
| UX checks (generic labels, tech leakage, small controls, route-signal consistency) | BI-353610C6 | Unit assertions |

**Deferred (owned, not rebuilt):** BI-348766E5 → #3403 (workspace attention reconciliation); BI-3DA1DFDC → #3387 (storefront inbox rows); BI-7C95A586 → #3402 (capacity legibility); **owner-first reframing of the `/finance` and `/employee` pages (BI-3BCAF95F, BI-001FD798, BI-3326DA86) → #3412** (`owner-first/` framework — shares those two page files, so this slice stays off them). These BIs stay open; this slice is additive and non-overlapping in files.

Single BI is not being kept for an xlarge — each deliverable maps to an existing live BI; no new BI or decomposition record required.

## Phases

1. **Read-model + tests** — `service-readiness.ts` (+ `.test.ts`). Green before UI.
2. **Loader + cockpit component** — `service-readiness-loader.ts`, `ServiceReadinessCockpit.tsx`. Mount on `/storefront`.
3. **Domain leads** — additive `FinanceOwnerLead` / `PeopleStaffingLead` server components + progressive disclosure on `/finance`, `/employee`.
4. **UX checks** — `service-readiness-ux.test.ts`.
5. **Docs + verify** — user-guide update, gate trailers, targeted vitest + typecheck, PR.

## Verification

- `vitest run` on the new `service-readiness*.test.ts` + `service-readiness-ux.test.ts`.
- `pnpm --filter web typecheck` on the touched surface.
- Production build routed through the shared local-CI sandbox (runtime-bound; not run inside the worktree).
- UX evidence: cockpit renders the one next action, Simple mode drops the technical block, tap target ≥44px.
