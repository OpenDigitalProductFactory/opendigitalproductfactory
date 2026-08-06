# Plan — "My Surface Backlog" panel (BI-012C0B58)

- **BI:** BI-012C0B58 (product / feature / build / medium) — EP-COMPETENCE-FLYWHEEL
- **Date:** 2026-08-05
- **Predecessor:** BI-474A1F55 (`list_my_backlog` + `coworker-scope.ts`, merged in #4042)

**For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Goal / definition of done

Phase 2 of the coworker backlog lens: a **human-facing** view of the coworker's own identity-scoped backlog slice, so the coworker and its human counterpart share one picture of the work driving the coworker's evolution. DoD = BI-012C0B58 acceptance criteria.

## Design grounding

- **Source of truth:** BI-012C0B58 + this plan. New artifact (a panel), grounded in the shipped `list_my_backlog` substrate.
- **Delivery decision (recorded):** `principle_decide` DI-FC0621051019 recommended **record-tab-scoped-list** (high confidence, margin 2.07) over a chat-side popover or a standalone route — reuse the coworker record page, no new route, lowest cognitive load. Captured as the ux-fit manifest.

## Substrate (verified 2026-08-05)

| Concern | Location |
|---|---|
| Host page | `apps/web/app/(shell)/platform/ai/agent/[agentId]/page.tsx` — tabbed coworker record; add one tab + one server child |
| Tabs component | `components/platform/coworker-record/CoworkerRecordTabs.tsx` (children in tab order) |
| Panel primitives | `components/platform/coworker-record/panels.tsx` (`Section`, `Chip`, `EmptyState`, `deepLink`) |
| Data pattern | server-rendered lib fn called in the page (cf. `lib/explore/backlog-data.ts`); coworker id = `record.runtime.agentId` |
| Shared query | `resolveCoworkerBacklogScope` (`lib/mcp/packs/coworker-scope.ts`) — reused, not reimplemented |
| Boundary | `coworker-record` is NOT a governed application-boundary context; app/components → lib is ungoverned (precedent: build-studio → `@/lib/mcp`) |
| CI gate | UX-Fit (`scripts/check-ux-fit-decision.mjs`) — route is sweep-excluded, so a `propose-n-pick` manifest is the path; no page-purpose regen (no new route) |

## Implementation

1. **Shared slice fn** `lib/coworker-record/surface-backlog.ts` — `getCoworkerBacklogSlice(agentId, {status?,workType?,limit?})` lifted from the `list_my_backlog` handler so the tool and the panel read one query. Returns `{ scope, summary, total, truncated, items }`.
2. **Refactor** the `list_my_backlog` handler to delegate to it (identical output/message; the shipped tool test still passes).
3. **Panel** `components/platform/coworker-record/MySurfaceBacklogPanel.tsx` — server component: scope line (portfolio · occupation) + honest `area + owned only` badge when `occupationArmApplied` is false, open/in-progress/done roll-up chips, item list with status dots + workType badges, `<details>` "show more" disclosure, `deepLink` to the full backlog. Theme tokens only.
4. **Wire** page.tsx — fetch the slice (fail-open), add a "Backlog" tab (badge = open count), render the panel as the matching child.
5. **ux-fit manifest** `docs/ux-fit/2026-08-05-my-surface-backlog-panel.ux-fit.json` — propose-n-pick, DI-FC0621051019, 3 considered options, scope = the panel file.

## Verification

- Unit: `surface-backlog.test.ts` (roll-up, identity-only scoping, invalid-filter drop, degrade); shipped `coworker-scope` + `coworker-backlog-lens` suites stay green through the refactor.
- `pnpm --filter web typecheck` clean; UX-Fit gate green; application/bundle/package boundary guards green; pregate.

## Backlog coverage

- **Umbrella BI:** BI-012C0B58 · **Decision:** `atomic` · **Receipt:** `cmsgys3rf05sc01nvn0l0qcq6`
- All four deliverables are internal sequencing (shared-slice → panel → wire-page / ux-fit); none is independently shippable.

## Risks & rollback

- **Tool output drift:** the refactor must keep `list_my_backlog`'s output identical — covered by the shipped pack test. Rollback: revert the handler to its inline query.
- **ux-fit scope mismatch:** `scope.files` must exactly equal the gate's UI-impacting set (files whose diff adds a control). Verified by running the gate on the committed diff before PR.
- **Fail-open fetch:** a slice read error renders an empty-state panel, never a 500 on the record page.
