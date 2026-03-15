# Agent Hands On Labels Design

## Overview

The coworker header currently mixes a mode-based button label (`Fill`) with a capability status badge (`Form fill enabled`). That wording is technically accurate, but it is not the terminology the product wants to use.

The user-facing concept should be:

- `Hands Off` when the coworker is in normal advisory mode
- `Hands On` when elevated form interaction is enabled for the current page

## Scope

This is a terminology-only change for the coworker header.

It applies to:

- the toggle button label
- the yellow status badge label
- the tooltip/help text on the toggle so it stays consistent with the new concept
- the associated header test expectations

## Design

- When elevated assist is disabled, the button label should read `Hands Off`.
- When elevated assist is enabled, the button label should read `Hands On`.
- The yellow badge shown when enabled should read `Hands On`.
- Tooltip text should explain the behavior in plain language:
  - the coworker can act on approved form fields
  - the human still reviews and submits manually

The implementation should keep the underlying state and variable names unchanged for now. This is a user-facing language adjustment, not a refactor of the assist model.
