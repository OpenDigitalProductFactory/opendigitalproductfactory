# Plan — Coworker UX Carry-Through (EP-26E528F5)

Spec: [2026-07-11-coworker-ux-carry-through-design.md](../specs/2026-07-11-coworker-ux-carry-through-design.md). One branch (`feat/coworker-ux-carry-through`), phased commits, single PR — the phases interlock through `platform-nav.ts` and the shared proactivity control, and the kernel scope decision makes retirement gate completion, so it lands atomically rather than as a deferrable tail.

## P1 — Record completion (BI-98329D0C)

1. `apps/web/components/platform/coworker-record/panels.tsx` — `PriorityPanel` gains `proactivitySection` + explainer card copy; record page passes a new client `CoworkerProactivitySetting` component (wraps `ProactivityLevelControl` + `get/saveCoworkerProactivityPreference`, load-clobber guard like the dock's).
2. `apps/web/app/(shell)/platform/ai/agent/[agentId]/page.tsx` — tab label `Priority` → `Priority & Autonomy`; mount the new section; fix `RecordActionsMenu` authority href → `/platform/ai/authority`.
3. `apps/web/components/agent/CoworkerProfilePanel.tsx` — read-only proactivity block → shared editable control (same actions); add "Open full record" link to `/platform/ai/agent/[agentId]`.

## P2 — Fleet home (BI-CF6D8C12)

4. `apps/web/lib/coworker-record/roster.ts` — `RosterRow.lastActiveAt: string | null` via one `AgentMessage.groupBy` query (role assistant, `_max.createdAt`).
5. `apps/web/components/platform/coworker-record/RosterView.tsx` — render relative last-active chip (viewer-TZ safe).
6. `apps/web/components/platform/platform-nav.ts` — add `{ label: "Workforce", href: "/platform/ai/overview" }` first in the AI family subItems.
7. `apps/web/app/(shell)/platform/ai/page.tsx` — redirect target → `/platform/ai/overview` (update `page.test.tsx`).

## P3 — Retirement (BI-E7E33D9B)

8. Delete `apps/web/components/platform/WorkforceTabNav.tsx` + `WorkforceTabNav.test.tsx` (zero usages).
9. ~~Assignments → outcomes link~~ — verified already present on `/platform/ai/assignments` ("See outcomes →"); no change.
10. `apps/web/components/employee/WorkforceRosterPanel.tsx` — agent rows deep-link to the record.

## Gates

- Worktree: `pnpm --filter web typecheck`, scoped `pnpm exec vitest run` on touched tests.
- `pnpm run pregate` (shared local-CI sandbox) before push.
- Live UX drive per spec §6 after merge/deploy; evidence via `record_execution_evidence`.
- PR trailers: `UX-Fit-Decision:` (extend-priority-tab, principle_decide 2026-07-11, high confidence) — spec/plan satisfy the Spec/Plan/Doc gate.
