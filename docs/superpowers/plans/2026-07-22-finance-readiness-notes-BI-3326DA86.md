# Coworker-drafted finance readiness notes (plan)

**BI:** BI-3326DA86 (final open acceptance clause)
**Date:** 2026-07-22
**Stacked on:** `claude/food-hospitality-subtype-money-jobs` (PR #3423)
**Guiding outcome:** close the last unimplemented clause of BI-3326DA86 —
*"coworker can draft readiness notes"*.

## Problem

The post-merge reconciliation of PR #3416 confirmed the owner-first finance
surface, the differentiated billing entry points, and the honest payment-run
copy, but recorded one clause with **no implementation at all**: the original
acceptance asked that the coworker be able to draft finance readiness notes.
Nothing on the finance surface offered that.

## Design grounding

- **Source of truth / existing substrate:** `apps/web/components/finance/AiFinanceCoworkerAskButton.tsx`
  already dispatches a prompt to the Finance Specialist via
  `dispatchAgentPrompt` (`apps/web/components/agent/AgentWorkLauncher.tsx`),
  and is already used that way in `AiSpendWorkspace.tsx`. This slice **reuses**
  that path — it adds no agent infrastructure, no new route, and no new model.
- **What is actually new** is the *prompt*: a pure builder that grounds the
  coworker in the figures already on screen.
- Extends `apps/web/lib/finance/finance-surface.ts` (the money jobs and subtype
  resolved there are what the note is written from).

## Changes

1. **`apps/web/lib/finance/readiness-note.ts`** (new, pure, dependency-free):
   `buildFinanceReadinessNotePrompt({ subtype, moneyJobs, metrics })` composes a
   prompt naming the business in the owner's terms ("my catering business"),
   quoting today's position from the live figures, and asking for 3–5 bullets of
   what needs attention / why it matters / safest next action.
2. **`OwnerFirstFinanceView`** gains a "Want this written up?" affordance that
   dispatches that prompt to the Finance Specialist with `routeContext="/finance"`.

## Honesty constraints (tested)

The prompt is deliberately constrained, because DPF is not the payment rail and
a drafted note is not an action:

- **Only real figures are quoted.** A money job with no live metric is *omitted*,
  never described with a placeholder — the coworker is never handed a number
  that does not exist. Action jobs (no-show fee, quote a job) carry no figure and
  are never quoted as if they did.
- **"Do not invent numbers or estimate anything that is not listed."**
- **Draft for review only:** no action taken, nothing sent, and an explicit
  instruction not to claim money has been paid or moved — *"recording a payment
  in DPF is not a bank transfer"*, the same boundary the payment-run disclosure
  enforces.
- When there are no figures at all, the prompt degrades to a setup-oriented note
  rather than fabricating a position.

The on-screen copy makes the same promise: *"It is a draft for you to review;
nothing is sent and no money moves."*

## Tests

`readiness-note.test.ts` — business naming per subtype; grounding in live
figures; subtype money-job language; the no-invented-numbers and
draft-only/no-money-moved constraints; omission of jobs without figures;
exclusion of action jobs; and the empty-figures fallback.
`OwnerFirstFinanceView.test.tsx` — the affordance renders with its no-action promise.

## Out of scope

- Persisting a drafted note as a record on the finance surface. Today the draft
  lands in the coworker panel for the owner to read and use; storing/attaching it
  would need a note model and an owner-acknowledgement path
  (cf. Propose-Acknowledge-Reassign) and should be its own BI if wanted.
