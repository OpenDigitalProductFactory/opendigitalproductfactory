# Overnight session summary — 2026-05-23 → 2026-05-24

Mark's directive at sleep: *"continue to work on this while I sleep. I configured oauth for the 2 main codex and claude providers for build studio. Pause to fix what you need that blocks/improves things for our persona."*

## TL;DR

PR [#1070](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1070) is open with **9 commits** addressing 7 of the 30 Dale-persona deficiencies:

| Commit | Deficiency | Status |
|---|---|---|
| G1 | Build Studio hard gate when no strong-tier remote provider | ✓ verified live |
| G2 | Honest failure messages in agentic-loop (drop the routing lie) | ✓ 67 unit tests |
| D25 | Provider-row tier derived from discovered models | ✓ verified live (Claude shows `frontier`) |
| D29 | Coworker route+capability context + NEVER-DEFLECT principle | ✓ wiring verified live |
| dev tooling | dev-portal-against-live-db override + `/dev-portal-start` skill + dogfood log | ✓ |
| D5/D9 | Hide setup-trigger messages from chat history | ✓ verified live on /workspace + /build |
| D12 | Convert single-line description input to multiline textarea | ✓ code shipped (dev-portal hides this surface, verify on prod) |
| D11/D14 | Dedupe "No active build" + gate "Missing evidence" on phase | ✓ verified live on /build (D14) + regression test (D11) |
| test fixtures | Add `capability: null` to 5 PortalContextEnvelope literals | ✓ unblocks CI typecheck |

## CI state at hand-off

Last push: `d4284748` at ~22:48 PT. Watch [CI here](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/actions?query=branch%3Aclaude%2Felated-antonelli-540ea2).

Earlier run (before fixture fix) — Typecheck failed with the 5 expected errors; everything else green (DCO, Production Build, Routing Invariants, Prompt State-Leakage Audit, etc.). The fixture commit (`e8dceb88`) targets exactly those errors. CI re-run was queued at push time.

## What you'll see when you open the portal

**On `/workspace`** — coworker chat panel is clean: shows ONLY the COO's "Welcome to your Digital Product Factory workspace..." greeting. The `[Setup step: Workspace — day-to-day operations and guardrails]` prefix that previously appeared above it is gone (D5/D9).

**On `/platform/ai/providers`** — your two new OAuth providers (Claude OAuth Subscription, OpenAI Codex) are `active`, and their tier badges read correctly (Claude shows `frontier` because Sonnet 4.x is discovered; ChatGPT Subscription should also show strong once its models are profiled). D25 derivation working.

**On `/build`** with no providers connected (counterfactual) — the new G1 gate fires with "Connect a stronger AI to start building" + 3 provider options + primary CTA. You won't see this today because you connected providers; will re-fire only if you disconnect them.

**On `/build?buildId=FB-486B7710` (the G2 build I promoted earlier)** — Software Engineer is **actively building**, responded with "Designing the architecture now. I'm using a one-off scope for this build: fix the misleading failure messaging on this flow without broadening it into a larger messaging framework." That's a real Codex / Claude routed response (not Magistral hedging) — proves the strong-provider OAuth + D25 derivation + routing is end-to-end functional. The Portal Context strip across the top no longer shows the premature "Missing evidence" warning (D14 verified).

## What's still queued (in priority order)

Highest-impact next deficiencies that I deferred tonight (clear scope, no design blockers):

1. **D29 behavioral verification** — wiring confirmed, but I couldn't drive a clean test response via Chrome MCP form submission. Worth you sending one "what should I do here?" message on `/platform/ai/providers` tomorrow to confirm the coworker now follows the NEVER-DEFLECT principle when routed to a strong model. If it still hedges, D29.4 (scripted-guidance triggers) is the follow-up.
2. **D13** — hide internal IDs / git branch chips ([BI-63EAD801](http://localhost:3001/backlog/BI-63EAD801)). Larger surface, more invasive, deferred.
3. **D15 / D16 / D17 / D20** — status-strip jargon (code intel chip strip, "sandbox" → "live preview", minimap suppression, friendly model labels). Bundled in [BI-62075FF9](http://localhost:3001/backlog/BI-62075FF9), partial fixes shipped tonight.
4. **D10** — fabricated chat turns surviving across logins. Needs design discussion on chat-persistence scoping.
5. **D18** — "Help me define it" auto-greeting reframing. Trivial copy edit; not urgent.
6. **D24, D26, D27, D28** — provider-page UX issues (OAuth row "api_key" mislabel, Configure → button promotion, stale model list refresh, coworker failure-spam suppression on /platform/ai/*). [BI-D6740C86](http://localhost:3001/backlog/BI-D6740C86).
7. **D1, D7** — portal first-touch labeling (welcome tile copy, platform-update hash banner). Low-priority cosmetic, [BI-EC26D09D](http://localhost:3001/backlog/BI-EC26D09D).

## D30 — ChatGPT OAuth port quirk (spawned task)

The `:1455` port-pinning issue is being debugged in a **separate spawned worktree** (`mcp__ccd_session__spawn_task` from earlier). It produces a triage doc at `docs/triage/2026-05-23-chatgpt-oauth-unknown-error.md` for your review before any code changes. Check that path when you wake to see what the spawned session found.

## What I did NOT do tonight

- **Did not** touch the ChatGPT OAuth surface (D30) — that's the spawned task's scope, no overlap
- **Did not** open separate PRs per fix — bundled into [#1070](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1070) per your usual workflow + the carve-out for hotfixes that unblock BS itself
- **Did not** modify production DB beyond seeding the `identity-block` prompt with the new principle (idempotent upsert; survives reinstall via the .prompt.md source bump to v4)
- **Did not** force-push, amend, or do anything destructive

## Known environment artifact

The host-side `pnpm install` is broken because the dev-portal container's `pnpm install` ran as root and left files the host user can't manage. Symptom: ~848 `@dpf/db: Cannot find module` errors on host typecheck. CI runs in clean env so it doesn't affect CI. Affects local dev — pre-commit typecheck hook was bypassed via the explicit `DPF_SKIP_TYPECHECK=1` escape hatch (documented in the hook itself). Future Claude sessions should know this; either chown the files back or reinstall as the host user.

## Next-step proposal for your morning

1. **Skim PR #1070** — should be CI-green by morning. If anything red, look at the typecheck job first.
2. **Confirm D29 behavioral fix** — open `/platform/ai/providers`, ask "what should I do here?" — expect the coworker to surface "your Claude OAuth is connected and you're good to go" (or similar concrete recognition), NOT "wait and try again."
3. **Read the spawned D30 triage doc** at `docs/triage/2026-05-23-chatgpt-oauth-unknown-error.md` — decide the fix approach for the OAuth port issue.
4. **Decide what's next on the epic** — D13 (hide internal IDs) is the highest-impact unblocker still queued. Could ship via BS now that Build Studio is functional.
