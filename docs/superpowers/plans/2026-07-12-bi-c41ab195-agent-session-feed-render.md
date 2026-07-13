# Implementation Plan — BI-C41AB195: agent-session feed render on the capsule page

**BI:** BI-C41AB195 (EP-WORK-CONVERGENCE) · **Date:** 2026-07-12 · **Status:** Render slice implemented (substrate + write tool already merged).

## Gap closed
The C41AB195 substrate shipped earlier: `AGENT_ACTIVITY_KINDS` (thought/action/question/response/error), the `recordAgentActivity` writer, and the `record_agent_activity` MCP tool. `getCapsuleDetail` already fetched `activities` — but the capsule detail page (`build/work/[capsuleId]/page.tsx`) rendered only the launch panel, so the activities were loaded and thrown away. This renders them.

## This slice
- `lib/work-capsules/agent-activity-presenter.ts` — pure `presentAgentSession(rows)`: typed agent activities get a plain label + own tone + actor (agent>human>system); lifecycle plumbing is toned "lifecycle" with a title-cased label. `hasAgentActivity` helper. Input order preserved.
- `components/build/AgentSessionFeed.tsx` — renders the entries as a teammate timeline (tone dot + label + actor + plain summary); empty state when no activity.
- `build/work/[capsuleId]/page.tsx` — render `<AgentSessionFeed activities={capsule.activities} />` (data already fetched).

## Verification
- Unit tests on the pure presenter (typed-vs-lifecycle, actor classification, order, hasAgentActivity). Typecheck.
- Live-portal (deferred to the epic validation pass): confirm a `record_agent_activity` call renders on the page.
