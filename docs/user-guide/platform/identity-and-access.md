---
title: "Identity And Access"
area: platform
order: 4
lastUpdated: 2026-04-25
updatedBy: Codex
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

## What To Watch

- direct fixes that bypass the canonical identity model
- role changes that accidentally widen access
- drift between directory records and effective authorization
