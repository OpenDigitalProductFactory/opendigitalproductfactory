# Coworker proactive opening briefing — implementation plan

**BI:** BI-DED493BA · **Epic:** EP-B9DD37C7 (coworker chat trust/transparency) · **Date:** 2026-07-09
**Delivery mode:** in-session (operator override of the Build-Studio-for-all-development rule, this thread)

## Problem

Founder headline from the Arcamanus operator dogfood: *"if we have to prompt to get
proactivity, we have failed."* Every coworker on every surface opened silent — a blank
panel — even at Proactivity = Assertive, and even on surfaces literally built around the
coworker (/customer/marketing had 7 work products waiting and 2 open decisions on-screen).

Root cause: `getOrCreateThreadSnapshot` returns whatever is in the `coworker:<route>`
thread and nothing seeds it. Proactivity today only drives self-task cadence and
per-turn prompt blocks — not in-panel presence. (The self-task output lands in a
`scheduled:*` thread the panel never reads.)

## Kernel decision

`principle_decide` (2026-07-09, external_coding_agent, callingSurface
claude-code-session-approach): **deterministic-ephemeral-briefing** — composite 9.94,
margin 2.19 over persisted-rows (7.75) and llm-auto-first-turn (6.12), confidence high.
Top contributors included *Never Fabricate*: the briefing is composed from queried rows,
not generated, so it cannot invent state.

## Design

1. **Pure composer** `apps/web/lib/agent/opening-briefing.ts`
   - `composeOpeningBriefing({ routeContext, proactivityLevel, items })` over the
     attention read-model (`AttentionItem[]`, already triage-ordered).
   - Proactivity gating: `quiet` → null (quiet means quiet); `balanced` → briefing only
     when items exist; `assertive` → always, including a spoken all-clear.
   - Headline = first surface-local item (deepLink prefix-matches the route's first two
     segments), falling back to the global triage top; remainder collapses to a count +
     link to `/workspace/inbox` (the Needs-you inbox).
   - Also exports `OpeningBriefingPayload` — the wire type lives here, NOT in the
     "use server" actions file (server-action modules may only export async functions;
     a type export there 500'd before, fixed in #2707).

2. **Server** — `getOrCreateThreadSnapshot` (apps/web/lib/actions/agent-coworker.ts)
   returns `openingBriefing: { content, agentId } | null` alongside messages:
   resolve route agent (`resolveAgentForRoute` + unified flag) → read the per-user
   proactivity UserFact → early-exit on quiet → `loadAttentionItems` +
   `filterAttentionForAudience({ operator: true })` (V1 operator-view, parity with
   /workspace/inbox; worker scoping is BI-AS-4) → compose. Wrapped in catch → null so a
   briefing failure never breaks thread load. Never persisted to `AgentMessage`.

3. **Client** — `AgentCoworkerShell` appends the briefing as an ephemeral assistant
   bubble (`withOpeningBriefing`, id `opening-briefing:<threadContext>` so load retries
   don't duplicate it). Renders through the existing ReactMarkdown bubble, so the
   deep links are clickable.

## Out of scope

- F19 collapsed-launcher default on customer surfaces (BI-8C3EB52C).
- Making recommendations actionable in-panel (BI-867263F4).
- Worker-scoped (non-operator) attention audiences (BI-AS-4).
- Bridging `scheduled:*` self-task threads into the panel.

## Verification

- Unit: composer gating/headline/fallback (opening-briefing.test.ts), shell injection +
  dedup + silent baseline (AgentCoworkerShell.test.tsx).
- Live: open the panel on /customer/marketing with pending outbound drafts → briefing
  names the most pressing item with a working deep link; quiet coworker stays silent.
