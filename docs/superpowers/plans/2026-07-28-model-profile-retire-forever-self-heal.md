# Model-profile retire-forever self-heal (BI-B6B8C1F9)

**Date:** 2026-07-28 · **BI:** BI-B6B8C1F9 · **Capsule:** WC-910D074A

## Incident

Coworker chat failed with "No AI model can handle this request right now."
A sensitive-data (restricted) request may only route to the local provider,
but `local/docker.io/ai/qwen3-coder:latest`'s ModelProfile had been retired
since 2026-07-21 (`retiredReason: "model_not_found from provider"`, recorded
during a transient DMR outage) even though DMR lists and serves the model
today. With Claude (`anthropic-sub`) disabled by a genuine OAuth token expiry
and ChatGPT public-clearance-only, the eligible set for the request was empty.

## Root causes

1. **Count-gated reactivation.** Discovery reconciliation
   (`apps/web/lib/inference/ai-provider-internals.ts`) only reactivated a
   retired profile while recovering a `missedDiscoveryCount > 0` — profiles
   retired by runtime 404s or by the dedupe/retriage migrations
   (BI-84792669 explicitly deferred reactivation as an "operational
   decision") carry a count of 0 and stayed retired forever.
2. **Blanket permanent-reason blocklist.** `model_not_found from provider`
   was never reactivated — correct for cloud catalogs that list sunset
   aliases (Google), wrong for local serving engines whose `/models` list is
   the serving truth.
3. **Local providers skipped reconciliation entirely**, so the local
   fallback had no return path at all.
4. **Versioned-base-URL 404s.** OpenAI-compatible dispatch appended `/v1`
   unless the base already ended in `/v1`; Z.ai's `…/paas/v4` became
   `…/v4/v1/chat/completions` → 404 → every GLM model auto-retired
   (BI-PIR-3ef04aa9), then trapped by (1).

## Changes

- `reconcileDiscoveredModelPresence()` extracted and fixed: presence in the
  fresh discovery list reactivates retired profiles regardless of the missed
  counter; the permanent-reason blocklist (`PERMANENT_RETIRE_REASONS`)
  still applies to cloud providers; local providers (DMR/Ollama) are exempt
  from the blocklist and from missed-count retirement.
- `packages/db/src/seed.ts` local-model loop un-retires an existing retired
  profile when DMR currently lists the model, so the bundled fallback heals
  at boot without waiting for the next discovery cycle.
- `resolveOpenAiCompatibleApiBase()` (`apps/web/lib/routing/openai-base.ts`)
  appends `/v1` only when the base URL does not already end in a version
  segment; adopted by chat-adapter, async-adapter, embedding-adapter, and
  async-inference polling.

## Non-goals

- `anthropic-sub` re-enable: token expiry is real (BI-PIR-e56afef0) and
  needs the operator's re-auth; the disable-on-auth-failure behavior with
  refresh-then-retry already exists and is correct.
- Served-context sizing for local models stays BI-3E614946.
- A UI action to manually un-retire a model profile remains open scope
  under BI-B6B8C1F9 follow-ups if self-heal proves insufficient.

## Verification

- Unit: `openai-base.test.ts`, new `reconcileDiscoveredModelPresence` suite
  in `ai-provider-internals.test.ts`, new Z.ai `/v4` case in
  `chat-adapter.test.ts`.
- Live: after deploy, portal boot seed reactivates `qwen3-coder`;
  `resolve_model_selection` should stop reporting `no-eligible-endpoint`
  for restricted-sensitivity routing once DMR serves an adequate context.
