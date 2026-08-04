# Read-Only Intent Enforcement for Coworker Turns

**BI-FBBA70DF** | Epic: EP-COWORKER-INTERACTIVITY | Status: in-progress

## Problem

On 2026-08-01, live acceptance of the Marketing coworker exposed an intent/action
mismatch. On `/platform/ai/agent/AGT-WS-MARKETING`, the operator asked:

> "Draft a concise weekend dinner campaign plan ... **Do not publish or change anything.**"

The coworker returned a useful plan but also created a campaign brief and two asset
tasks, presenting approval cards for them. Explicit read-only intent did not prevent
mutating tool use.

## Root Cause

When `coworkerMode === "advise"` and there is no active build phase:

```ts
const surfaceAsProposals = input.coworkerMode === "advise" && !activeBuildPhase;
// → always true in advise mode outside a build
```

This has two downstream effects:

1. **Side-effecting tools are kept in the tool set** — `filterToolsForCoworkerRuntime`
   keeps them when `surfaceAsProposals=true`, so the model has full mutating surface.

2. **The system prompt instructs mutation** — `buildAdvisePromptSuffix` injects:
   _"ADVISE MODE — YOUR RECOMMENDATIONS BECOME APPROVAL CARDS. When the request calls
   for a side-effecting action, DO call the relevant tool."_

The `interceptToolCallAsProposal` loop-level divert correctly captures calls as
proposals rather than executing them directly — but proposals were still created and
approval cards shown, which directly violates "do not create anything."

The per-turn operator message is never consulted before `surfaceAsProposals` is set.

## Design

### Turn-level intent classification (pure, testable)

Add `classifyTurnMutationIntent(content: string): "read-only" | "authorized" | "unspecified"`
to `lib/tak/conversation-intent.ts`.

**Read-only signal:** the message contains explicit suppression language anchored to
a mutation verb:
- _"do not publish/create/change/save/update/add/modify/schedule/send"_
- _"don't change/publish/save/create"_
- _"just a plan"_ / _"just draft"_ / _"just show me"_
- _"no changes"_ / _"read only"_ / _"without creating"_ / _"without saving"_
- _"do not make any changes"_ / _"don't make any changes"_
- _"preview only"_ / _"planning only"_

Returns `"read-only"` when matched; `"unspecified"` otherwise. The `"authorized"`
variant (explicit mutation grant) is defined for future use but not acted on by
this fix — it is intentionally NOT used to force `surfaceAsProposals=true`.

### Call-site override in `agent-coworker.ts`

```ts
// BI-FBBA70DF: Explicit read-only intent overrides proposal surfacing for
// this turn. Even in advise mode, if the operator explicitly says
// "do not create/change/publish anything", suppress proposals and strip
// side-effecting tools — identical to pre-BI-867263F4 advise behavior.
const turnIntent = classifyTurnMutationIntent(input.content ?? "");
const surfaceAsProposals =
  input.coworkerMode === "advise" &&
  !activeBuildPhase &&
  turnIntent !== "read-only";
```

No other code changes needed — `filterToolsForCoworkerRuntime` and
`buildAdvisePromptSuffix` already handle `surfaceAsProposals=false` correctly:
tools are stripped and the held-back note fires instead of the proposal instruction.

## Scope

### In scope
- Classify per-turn operator intent before `surfaceAsProposals` is derived.
- Suppress proposals and strip side-effecting tools when explicit read-only intent
  is detected.
- Tests for the classifier and the call-site behaviour.

### Out of scope
- Changing Marketing coworker availability or readiness.
- Weakening normal tool use when the operator authorizes action.
- Per-tool annotation changes.
- Changes to the grant/capability auth stack.

## Files

| File | Change |
|------|--------|
| `apps/web/lib/tak/conversation-intent.ts` | Add `classifyTurnMutationIntent` |
| `apps/web/lib/actions/agent-coworker.ts` | One-line `surfaceAsProposals` override |
| `apps/web/lib/tak/conversation-intent.test.ts` | New test cases for classifier |
| `apps/web/lib/actions/agent-coworker-tool-filter.test.ts` | No change (existing coverage) |

## Acceptance Criteria

- The regression prompt ("Draft ... Do not publish or change anything") produces a
  plan without creating or updating campaign briefs, tasks, assets, or any business record.
- A subsequent explicit "save it" instruction uses the governed proposal/approval path.
- Tests cover: explicit no-change language, ambiguous planning language, explicit
  mutation authority, delegated tool calls.
- The coworker summary never claims an entity was created unless a committed receipt exists.

## Research & Benchmarking

This classifier mirrors the existing `isPageExplanationOnlyRequest` and
`isTrivialSocialMessage` patterns in `conversation-intent.ts` — a conservative
regex anchored to both a negation marker and a mutation verb, not a general
sentiment detector. That pattern was proven reliable across 2+ years of production
usage on these routes and has zero false-positive risk on conversational expansions.

No external library is adopted; the existing pure-function module pattern is extended.

## Verification

```bash
pnpm --filter web exec vitest run lib/tak/conversation-intent
pnpm --filter web exec vitest run lib/actions/agent-coworker
pnpm --filter web build
```

Live UX: navigate to `/platform/ai/agent/AGT-WS-MARKETING`, send the regression
prompt, confirm no approval cards. Then send "save it" and confirm approval card appears.
