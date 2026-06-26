# Marketing coworker — route-aware fabrication guard

- **BI:** BI-3E92B28B
- **Epic:** EP-MARKETING-EXEC
- **Date:** 2026-06-25
- **Surface:** `apps/web/lib/tak/agentic-loop.ts`

## Symptom

On `/customer/marketing` the Marketing Strategist would answer a "lets go" /
"go" continuation with:

> I couldn't complete that — the underlying work wasn't recorded. Try rephrasing
> the request, or open the build details to see what's saved so far.

A chat route has no "build details" panel, so the copy is nonsensical and the
user is blocked from establishing or executing a campaign. The model's actual
advice (a segment profile, a campaign brief, etc.) was discarded.

## Root cause

The agentic-loop **fabrication guard** is build-oriented. Its job is to stop a
*build* agent from falsely claiming it shipped code without calling a tool
(`detectFabrication` → retry → `buildFabricationFailureMessage`).

`/customer/marketing` is the **one advise-mode conversational route that still
carries authoritative artifact tools**: `save_marketing_review`,
`create_marketing_campaign_brief`, `create_marketing_asset_task`, … are
`sideEffect: true, coworkerArtifact: true`, so `coworker-tool-filter.ts` keeps
them in advise mode (saving advice is part of the advisory workflow). That makes
`hasAuthoritativeToolAvailable` true, which **arms the guard on a chat**.

So when the model narrated a concrete recommendation ("…let me draft the campaign
brief now") without emitting the persist tool call, the loop:

1. retried once with a build/code nudge (`"Do NOT show code to the user"`), then
2. **threw away the advice** and substituted `buildFabricationFailureMessage`
   ("open the build details").

The capability itself was fine — the marketing roster is real and DB-backed
(`save_marketing_review` @ mcp-tools.ts, `create_marketing_campaign_brief`,
`draft_marketing_asset`; external publish stubbed via `lib/marketing/publish`).
The guard was hiding a working establish→execute flow.

## Fix

Route-aware handling at the fabrication call site and in the MAX_ITERATIONS
fallback. `detectFabrication` stays pure; the route policy lives at the call
site, mirroring the existing downgraded-turn precedent (Slice D).

For **non-`/build` (conversational) routes**:

- Retry once with a **domain** recovery nudge that tells the model to call its
  persist tool (`save_marketing_review` / `create_marketing_campaign_brief`) and
  to keep — not suppress — its advice. No "show code" language.
- If the model still won't persist, **keep the advice** instead of nuking it.
- Append an honest, conversational "not saved yet" note
  (`buildUnsavedAdviceNote`) **only** when the reply makes a hard, unbacked
  completion claim (`HARD_COMPLETION_CLAIM_PATTERN` — "I've saved that", "it's
  now live", "in your approval queue"), so the user is never misled.
- `buildFabricationFailureMessage` gets a conversational variant with no "build
  details" reference (last-resort only).

**`/build` routes are unchanged**: retry ×3, then the existing fabrication /
downgraded copy.

## Tests

`apps/web/lib/tak/agentic-loop.test.ts`:

- `HARD_COMPLETION_CLAIM_PATTERN` matches misleading persistence/publish claims,
  not intent/narration or plain advice.
- `buildUnsavedAdviceNote` is route-specific and never mentions builds.
- Integration: a marketing route that narrates without a tool call **keeps the
  advice** (no build copy, no spurious note); a hard completion claim **keeps the
  advice + appends the note**; the recovery nudge carries `save_marketing_review`
  and not "Do NOT show code".

92 tests pass (85 prior + 7 new).
