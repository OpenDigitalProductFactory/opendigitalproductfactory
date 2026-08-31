# Canonical Pre-Human Escalation Gate

**Backlog:** BI-51821119  
**Epic:** EP-7B169558  
**Decision:** DI-45E8FB6E767F  
**Workroom:** WC-499594A8

**Reconciled:** 2026-11-10 against deployed `cc34280ba737347be8b4d9d575f8cdd0b5dc4d19`

## Problem

DPF has the right decision surfaces but does not route every ambiguous platform/build question through them before asking a human. The current external-client guard sees only structured `AskUserQuestion` / `AskQuestion` calls with two or more options. Plain prose such as “If you say create the finishing task…” escapes. A Workroom can also be marked blocked with a decision-shaped reason without recording whether the agent consulted WWMD or why a human answer is genuinely required.

The instruction plane compounds the gap. `AGENTS.md` says to have the operator classify an ambiguous request, while the later work-scope rule and `consult-scopes-before-asking` say to consult the owning decision scope first. The specific principle likewise permits a cold classification question. The system therefore presents two incompatible next actions at the moment ambiguity occurs.

## Current-tree reproduction

Named baseline: deployed `origin/main` at `cc34280ba737347be8b4d9d575f8cdd0b5dc4d19`.

- The deployed `update_workroom_status` tool exposes only `capsuleId`, `status`, and free-text `reason`; `updateWorkCapsuleStatusTool` performs no pre-human routing validation.
- Canonical-runtime probe `WC-618084CF` accepted `blocked` with the incident reason “Waiting for the operator to choose whether I should create the finishing task.” and persisted it without a routing disposition or `DecisionInteraction`; the disposable probe was then archived.
- `packages/dpf-skill-pack/hooks/decision-routing-guard.mjs` now covers structured question tools and broader product/roadmap language, but it still cannot govern a plain assistant sentence. This narrows the remaining enforcement gap to durable Workroom state and the instruction plane.
- `packages/dpf-skill-pack/skills/dpf-decision-via-kernel/SKILL.md` still advertises only “two or more architecturally-distinct options,” so recovery ambiguity and “how should I proceed?” remain weak trigger matches.
- `AGENTS.md` and `docs/founder-kernel/wiki/principles/classify-ambiguous-requests-before-acting.md` permit asking the operator before the governing scope is consulted.
- `update_workroom_status` accepts only `capsuleId`, `status`, and free-text `reason`; it carries no routing disposition for decision-shaped blockers.

The regression proof starts with tests for the incident phrase and for a decision-shaped Workroom blocker. Both must fail on this baseline and pass after the fix. The deployed probe above supplies functional red evidence for the Workroom boundary.

## Ruled-out causes and approaches

- **Feature naming:** ruled out. WWMD and the decision skill are already named and documented; the missing link is trigger and enforcement coverage.
- **Missing decision substrate:** ruled out. `principle_decide`, `DecisionInteraction`, WorkWarrant altitude classification, the coworker prompt block, and the external-client hook already exist.
- **Another decision engine or ledger:** rejected. It would duplicate the canonical substrate and increase the number of paths that can drift.
- **Question-hook-only repair:** ruled out by the current tree. The hook has since gained broader vocabulary and multi-client envelopes, while the deployed Workroom transition still accepted the incident bypass.
- **Prompt-only repair:** rejected. The current prompt already says “consult before you propose or ask”; the incident proves instruction alone is not an enforcement boundary.
- **Treat every blocker as a decision:** rejected. Authentication, unavailable infrastructure, and missing artifacts are factual blockers and must remain representable without a fake decision receipt.

## Decision

Implement DI-45E8FB6E767F’s `canonical-pre-human-escalation-gate` using the existing planes:

1. One small pure routing contract classifies a human-facing interruption as `factual-clarification`, `owner-consent`, `scope-resolved`, or `legitimate-escalation`.
2. `scope-resolved` and `legitimate-escalation` require the existing `DecisionInteraction` identifier. No new table or ledger is introduced.
3. The Workroom status boundary rejects a decision-shaped `blocked` reason with no disposition, while factual blockers remain valid.
4. External question hooks retain their narrow enforcement boundary; current structured-tool coverage remains green while the prompt and skill make the plain-prose recovery path explicit.
5. The always-on prompt, skill trigger, and doctrine use the same consult-before-ask order.

The gate does not remove explicit human authority. Destructive actions, outbound commitments, spend, credentials, and owner-only consent remain human gates and use `owner-consent`, not a fabricated kernel decision.

## Ordered implementation plan

1. Add failing unit tests for the incident phrase, routing-disposition validation, and factual-blocker compatibility.
2. Add the pure pre-human routing contract and enforce it in `update_workroom_status` without schema migration.
3. Preserve the current external question guard coverage and update the coworker prompt to route blocked/stuck recovery and “how should I proceed?” through WWMD before asking.
4. Reconcile `AGENTS.md`, the ambiguity principle, and the WWMD skill trigger; keep `AGENTS.md` smaller and keep the skill description within the instruction-plane byte ratchet.
5. Run affected tests, skill corpus guards, preflight, production build, semantic review, exact-tree gate, and PR readiness.

## Acceptance mapping

| Acceptance outcome | Verification |
|---|---|
| Incident cannot cold-ask for a finishing task | `decision-routing-guard.test.mjs` regression |
| High-confidence scope resolution carries a ledger | routing contract requires `DI-*` for `scope-resolved` |
| Legitimate escalation carries its ledger/reason | routing contract requires `DI-*` for `legitimate-escalation` |
| Owner consent remains available | routing contract accepts `owner-consent` without a DI |
| Factual blockers remain representable | Workroom handler test accepts a factual blocked reason without a DI |
| Decision-shaped Workroom blockers cannot bypass WWMD | Workroom handler test rejects missing disposition and invalid DI binding |
| Plain/structured paths share policy where enforceable | prompt contract covers plain output; client hook covers supported question tools; Workroom boundary covers durable blocked state |
| Doctrine no longer conflicts | prose assertions plus the `AGENTS.md` size ratchet |
| No parallel substrate | schema diff remains empty; existing `DecisionInteraction` id is referenced |

## Documentation impact

This changes developer-agent and coworker behavior, so the canonical ambiguity principle, the WWMD skill, and the always-on coworker routing prompt change in the same PR. No user-facing product route or installation procedure changes.
