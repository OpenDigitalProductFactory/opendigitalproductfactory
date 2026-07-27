---
title: "Identity And Access"
area: platform
order: 4
---

## Use This Doc For

- `/platform/identity`
- `/platform/identity/agents`
- `/platform/identity/applications`
- `/platform/identity/authorization`
- `/platform/identity/directory`
- `/platform/identity/federation`
- `/platform/identity/groups`
- `/platform/identity/principals`

## Workflow

1. Start with the identity object you need to explain or change.
2. Check group and authorization posture before editing the principal directly.
3. Validate downstream effect on route access, tool grants, and coworker authority.

Coworker actions are re-evaluated when the tool actually runs. The platform
intersects the current human authority, coworker grant, delegated scope,
record scope, connection state, data sensitivity, and HITL policy. A denial is
returned as a plain-language explanation; an action that needs judgment pauses
the originating task and creates one approval envelope. Approving that envelope
does not approve a different task or changed action.

## What To Watch

- direct fixes that bypass the canonical identity model
- role changes that accidentally widen access
- drift between directory records and effective authorization
- assuming a prompt, model fallback, or cheaper provider can widen authority
- approving a coworker action without checking the named action and record scope
