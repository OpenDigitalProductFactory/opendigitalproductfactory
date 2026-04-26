---
title: "Setup And First Login"
area: getting-started
order: 5
lastUpdated: 2026-04-25
updatedBy: Codex
---

## Use This Doc For

- `/setup`

## Workflow

1. Complete initial platform setup.
2. Confirm the first internal user can authenticate and reach the internal shell.
3. Move into the relevant operational area only after setup and first-login checks succeed.

## Help Visibility Policy

- `/setup` should expose a visible help link because it is still an internal operator workflow.
- `/login`, `/forgot-password`, `/reset-password`, `/welcome`, and `/sandbox-restricted` should not expose internal docs links directly.
- `/portal/*`, `/customer-login`, `/customer-signup`, `/customer-complete-profile`, `/customer-link-account`, and public storefront `/s/*` routes should not expose internal docs links.
- Public, portal, auth, and token-action surfaces still need explicit documentation coverage decisions, but those decisions do not automatically mean a visible internal Docs button.
