---
title: "Authority And Audit"
area: platform
order: 3
---

## Use This Doc For

- `/platform/ai/authority`
- `/platform/audit`
- `/platform/audit/authority`
- `/platform/audit/journal`
- `/platform/audit/ledger`
- `/platform/audit/metrics`
- `/platform/audit/operations`
- `/platform/audit/routes`

## Workflow

1. Confirm what authority or action path you are reviewing.
2. Inspect the recorded execution or decision trail.
3. In the Effective Permissions inspector, select the user role and AI coworker
   whose combined access you need to understand.
4. Separate user permission issues from agent-grant issues before changing
   configuration. Quiescence status requires the existing
   `release_plan_read` grant and does not mutate the platform.

## What To Watch

- actions that appear available in UI but are blocked at execution time
- missing or unclear audit evidence for a sensitive action
- route-level policy changes that alter visible authority without documentation
