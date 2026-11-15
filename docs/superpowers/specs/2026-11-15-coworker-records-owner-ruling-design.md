---
status: active
---

# A coworker records the owner's ruling on an escalated decision review

BI-0C0B0836 (small).


## Problem

When the kernel cannot answer a decision, it escalates it to a person as an open decision review. The owner answers these in the portal with the "Answer" control (`captureOrgDecisionOutcome` for business reviews, `captureDecisionInteraction` for build reviews). Both are server actions bound to the browser session.

On 2026-11-14 the owner gave the COO rulings on four open reviews in its chat on /coworker-decisions/review. The COO's only write tool, `record_decision_outcome`, refused every one with `no-recommendation`. That tool records agreement with a kernel recommendation, and an escalated review has none. The owner would have had to re-enter each ruling in the portal. The owner's direction is that rulings are recorded by the in-platform coworker.

The surface contract `decision-governance.open-reviews` declares no act tool, with the exemption "coworker agency is read and recommend, not unilateral resolution". That exemption still holds for the coworker acting on its own. It does not cover a ruling the owner has given.

## Comparable approaches

| Approach | Example | Who decides | Fit |
| --- | --- | --- | --- |
| Agent self-attests that a human chose | `record_decision_outcome(resolvedBy: "human")` | the agent's claim | Rejected. Nothing proves a person chose, so this is self-approval. |
| Confirmation before a consequential tool call | MCP specification, tools: "there SHOULD always be a human in the loop with the ability to deny tool invocations"; LangGraph `interrupt` for human approval; Microsoft 365 Copilot action confirmation cards | the person, per call | Adopted. |
| Standing delegated authority | an OAuth grant or a standing ruling that lets the agent close reviews | a past grant | Rejected for rulings. A ruling is a one-off judgement, not a class of action to pre-authorise. |

## Design

- **New tool `record_owner_ruling`** (pack `owner-ruling`), declared `executionMode: "proposal"`.
  - The escalation gate's first branch (`declared-proposal`) always sends a proposal to a person, whatever the coworker's trust tier or transport. The owner confirms it with one action.
  - Inputs: `interactionId`, `answer` (the owner's words), optional `rationale`, optional `chosenOptionId`.
- **Attribution.** The ruling is recorded as the human the chat belongs to (`resolverUserId` = the executing user), never as the agent.
- **One write path.** The bodies of both server actions move into a server-only module, `lib/decision/owner-ruling-capture.ts`, as functions that take the user explicitly.
  - The actions keep their own capability check and call the core.
  - The core is not a `"use server"` export, so no client can pass a user id.
  - Business reviews close their semantic cluster exactly as the "Answer" control does. Build reviews keep the build-owner check.
- **Surface contract.** `decision-governance.open-reviews` declares `record_owner_ruling` as its act tool. The route's page data tells the coworker to record a ruling only when the owner gives one in the chat.

## Not in scope

- Making the ruling a standing stance. The owner keeps that option in the portal.
- Changing `record_decision_outcome`.

## Verification

- Unit: the core records a business review and its cluster, and records a build review as the build owner. It refuses a gate-resolved review, an already-answered review and an option that was not offered.
- Unit: the tool is declared a proposal, so the gate sends it to a person.
- Live: the COO proposes the four rulings. Once the owner confirms, each review's `humanOutcome` names the owner.
