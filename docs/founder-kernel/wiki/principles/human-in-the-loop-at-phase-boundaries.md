---
title: Human-in-the-Loop at Phase Boundaries
pageKind: principle
status: published
abstract: Use phase boundaries to identify missing judgment or authority; do not require fresh approval solely because a phase changes.
principleTier: commandment
principleDirection: Use phase boundaries to identify missing judgment or authority; do not require fresh approval solely because a phase changes.
principleDimensionVector: {"governance_compliance": 1.0, "human_cognitive_load": -0.6, "speed_to_value": 0.5, "legibility_of_consequence": 0.7, "customer_consent_state": 0.65}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
  - ring-4-sandbox-prod
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: Documents DPF's HITL governance posture for adopters and contributors — anyone running the platform needs to know where approvals are required and where the agent operates autonomously.
sources:
  - frameworks/it4it-v3
---

## Rule

A phase boundary is an opportunity to evaluate whether judgment or authority is missing, not an automatic requirement for human approval. Reuse authorization within its scope. Ask again only when a material consequence, commitment, scope, or authority changes, or when the action's governing policy requires action-specific consent.

Within authorized work, agents operate autonomously using their scoped tools. Verification checks still establish whether a transition is valid; completing those checks does not require a second human decision when the direction and authority are already settled.

## Why

An approval that cannot change the decision is a rubber stamp. Moving repeated confirmations from tool calls to phase boundaries only batches the waste. Human review belongs where a person has a consequential judgment or authorization to supply, with the result and consequences made clear before consent.

Founder correction, 2026-09-05, BI-DC0F14E0: this replaces the earlier blanket requirement for approval at ideate-to-plan, plan-to-build, and review-to-ship transitions. It does not remove access controls, protected merge checks, required independent findings, or action-specific consent.

## How to apply

At a transition, use the existing decision, authorization, and relevant verification. Continue if they cover the proposed action. If they do not, resolve the missing facts or checks through the existing process, and ask a human only for the judgment or authority that remains missing. Do not add a separate approval form to establish that no approval is needed.

A production-affecting action follows its actual permission and consent contract. Its phase label neither grants permission nor invalidates permission already given. Where a tool requires a proposal or specific approval, use it; WWMD judgment does not substitute for that authorization.

## Decision dimensions

The vector retains compliance with applicable governance (1.0), consent state (0.65), legible consequences (0.7), reduced cognitive load (-0.6), and speed to value (0.5). Compliance and consent describe whether required protections and actual authorization are satisfied, not the quantity or recency of approval clicks. Reusing valid authorization therefore preserves those benefits while reducing interruption cost; skipping required consent lowers compliance and consent-state features. This interpretation supports the revised direction without reversing any cost axis or changing the numeric weights merely to force a preferred result.

## Examples

- The operator authorizes implementing and delivering a named repair. The agent performs the scoped work and verification, then proceeds through the authorized delivery path without asking whether to continue at each stage.
- The repair reveals an unapproved destructive migration. Present its concrete consequence and obtain the required consent before execution.
- A workflow requests the same approval after each evidence upload, although nothing material changed. Consolidate that repetition instead of counting it as additional governance.

## Related principles

- [[principles/consult-scopes-before-asking]] — settle direction in the owning doctrine.
- [[governance-approves-evidence-not-provenance]] — evaluate meaningful evidence once within its scope.
- [[show-the-consequence-before-the-confirm]] — make necessary consent legible.
