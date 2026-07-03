# Proactivity level drives in-task initiative

- **BI:** BI-E35A8AA4
- **Epic:** EP-F7E35344 (coworker autonomy / decision-routing)
- **Date:** 2026-07-03
- **Companion:** PR #2557 (CSM close-the-loop persona fix)

## Problem

The per-coworker **Proactivity** control (`quiet` | `balanced` | `assertive`,
[ProactivityLevelControl.tsx](apps/web/components/proactivity/ProactivityLevelControl.tsx))
implies how hard the coworker will work. In reality it resolves only to a
*notification* plan — attention window, follow-up cadence, escalation target,
`spendClass`, `actionBoundary` — in
[proactivity-resolver.ts](apps/web/lib/proactivity/proactivity-resolver.ts).
That plan is stored in `TaskRun.a2aMetadata` and **never reaches prompt
assembly or the agentic loop**. `PromptInput`
([prompt-assembler.ts](apps/web/lib/tak/prompt-assembler.ts)) has no proactivity
field, so the system prompt and tool-use behavior are byte-identical at
`assertive` and `quiet`. Assertive only *pings the user more often*; it does not
make the coworker close open loops.

Concretely (the Emma3D prospect-add case): asked to add a prospect and a
contact, the coworker stalled on a missing email instead of — under an
assertive posture — researching the contact itself and asking only for the
residual.

## Goal

Make the Proactivity level modulate **in-task initiative**: how hard the
coworker works to close a gap with its own tools before handing back, and how
readily it takes the next well-supported action — bounded by the existing
authority, mode, and no-fabrication guardrails. Notification behavior is
unchanged.

## Design

### Initiative block (new)

`apps/web/lib/tak/initiative-block.ts` — mirrors
[decision-routing-block.ts](apps/web/lib/tak/decision-routing-block.ts):
a pure function `buildInitiativeBlock(level: ProactivityLevel | null): string`
returning a directive keyed by level. `null` maps to `balanced` (the UI's
effective default), so the block always reflects the level shown in the dock.

| Level | Directive gist |
|---|---|
| `quiet` | Do what's asked and stop. Don't chase missing details or take extra steps; surface what you have and let the employee drive. Ask at most one question, only if the task cannot proceed at all. |
| `balanced` | Take the next well-supported action; make a reasonable effort (a quick lookup) to recover a missing detail before asking; batch what you still need into one short question; propose the following step. |
| `assertive` | Drive to completion. When something is missing, exhaust your own tools to close the gap first — research/derive/look it up — and ask only for what you genuinely could not obtain, stating what you recovered. After the request, take the next well-supported action that advances the goal. Never fabricate a value to avoid asking; never exceed authority or send anything externally — initiative is effort, not overreach. |

The `assertive` text explicitly re-states the no-fabrication and
no-overreach bounds so a higher initiative level cannot be read as license to
guess or to exceed the granted authority / mode.

### Threading

1. `PromptInput` gains `proactivityLevel?: ProactivityLevel | null`. The
   assembler pushes `buildInitiativeBlock(input.proactivityLevel)` into the
   **dynamic** blocks (it varies per user/session, so it must sit after the
   cache boundary), right after the Authority block.
2. `agent-coworker.ts sendMessage` resolves the level once via
   `getCoworkerProactivityPreference(agent.agentId)` and:
   - **unified path** — passes `proactivityLevel` into `assembleSystemPrompt`;
   - **legacy path** — pushes `buildInitiativeBlock(level)` into
     `promptSections`, adjacent to the decision-routing block, so both paths
     are surface-uniform (the `USE_UNIFIED_COWORKER`-off install default gets
     the same behavior).

### Non-goals

- No change to notification cadence, escalation, or the resolver plan shape.
- No autonomous background loop — initiative only shapes the in-turn response;
  the approval-card contract and mode gating are untouched.
- SOC/governance web egress is out of scope (separate governed-intel item).

## Tests

- `initiative-block.test.ts`: each level yields a distinct, non-empty directive;
  `assertive` contains the close-the-gap + no-fabrication language and `quiet`
  the do-and-stop language; `null` === `balanced`.
- `prompt-assembler` test: assembling with `proactivityLevel: "assertive"`
  includes the assertive directive; omitting the field falls back to balanced.

## Rollout

Prompt/code change only — takes effect on portal rebuild. No migration. Level
already persisted as a `UserFact`; no schema change.
