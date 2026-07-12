# P6 — Ambiguity reduction & cognitive-load removal

- **BI:** BI-0806FFF5 · **Epic:** EP-27FD96BC
- **Scope spec:** `docs/superpowers/specs/2026-07-11-coworker-reasoning-economy-scope.md`
- **Kernel:** no work-scope/altitude sub-decision — consolidating an existing scattered discipline into the shared contract.

## Problem (from the audit)

Clarify-vs-proceed guidance existed, but only **scattered inside individual personas** (`agent-routing.ts:21`, `:456`) — some coworkers got "ask at most one question / one clarification round then act", others got nothing. The result was inconsistent: coworkers over-asking, handing decisions back as menus, and making the operator specify details they could reasonably infer — cognitive load added, not removed. And the "act on your own recommendation" half was missing.

## Approach — one discipline in the shared contract

Substrate-verify-first: the `COWORKER_INTERACTION_CONTRACT` (`coworker-interaction-contract.ts`) is the reusable block already appended to every coworker prompt via `withCoworkerInteractionContract` (through `prompt-assembler.ts`, build/specialist prompts, and route personas). It governs closeouts; this adds the missing **upfront** clarify-vs-proceed clause so the discipline is coherent and universal instead of per-persona.

The clause encodes three things:
- **Ask less** — prefer proceeding on a clearly-stated reasonable assumption; at most ONE focused question, and only when a wrong assumption would be costly/irreversible/misleading. Everyday ambiguity is the coworker's to resolve.
- **State assumptions** — when proceeding on one, say so in a line and give the recommended action to confirm/correct, rather than making the operator specify everything first.
- **Act on the recommendation** — when one option is clearly best, take it (or tee it up) and name it; don't hand back a menu you can resolve yourself.

## Verification
- Unit (`coworker-interaction-contract.test.ts`): the contract now carries the clarify-vs-proceed / ask-less / act-on-recommendation discipline (and still appends once, with all four closeout fields).
- Typecheck clean.

## Non-goals
- Runtime interception of a coworker's draft to rewrite over-asking responses — behavior-shaping via the shared prompt contract is the right, low-risk mechanism; a draft-nudge is a separate slice.

**UX-Fit:** this changes coworker conversational behavior (ask fewer questions, state assumptions), not any UI surface or control — no new route, tab, or field. The change makes the coworker *less* demanding of the operator, reducing cognitive load.
