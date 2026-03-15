# Agent Chat Send Polish Design

## Overview

The coworker panel currently has two UX problems:

- erasing a chat uses the browser's native `confirm()` dialog, which does not match the portal visual language and appears detached from the user's click target
- user messages are only shown after the server round-trip completes, which makes the panel feel laggy and obscures whether a message is still sending or has failed

This slice replaces the native confirmation with a portal-styled popover anchored to the `Erase` control and adds optimistic local echo with visible message send states.

## Goals

- keep destructive confirmation inside the portal UX
- place the erase confirmation near the `Erase` action
- show the user's typed message immediately after submit
- represent send state inline in the chat transcript
- keep failed messages visible and retryable

## Non-Goals

- delivery and read receipts across providers
- full offline sync
- multi-device reconciliation
- proposal approval UX changes

## UX Design

### Erase Confirmation

The `Erase` action in the coworker header opens a lightweight popover anchored to the header control.

Behavior:

- clicking `Erase` opens the popover instead of `window.confirm`
- the popover uses the portal visual style
- the popover includes:
  - short warning text
  - `Cancel`
  - `Erase`
- clicking away or pressing `Escape` closes the popover
- confirming runs the existing server action and shows the existing `Erasing...` pending state

This keeps the confirmation local to the interaction and visually consistent with the rest of the portal.

### Optimistic User Messages

When the user sends a message:

1. the message is inserted into the transcript immediately
2. it is marked as `sending`
3. the input is cleared immediately
4. the server request runs in the background
5. on success, the optimistic message becomes `sent`
6. on failure, the optimistic message becomes `failed`

The user should never have to wait for the assistant response to see their own message appear in the conversation.

### Message States

For MVP the user message supports three visible states:

- `sending`
- `sent`
- `failed`

Presentation:

- `sending`
  - same user bubble shape
  - slightly muted opacity
  - small inline status label such as `Sending...`
- `sent`
  - normal user bubble
- `failed`
  - user bubble remains visible
  - inline status such as `Not sent`
  - retry affordance next to the status

State must not rely on color alone.

## Component Changes

### `AgentCoworkerPanel`

Responsibilities added:

- maintain optimistic local user messages
- reconcile optimistic messages with server-confirmed messages
- track pending and failed send state
- own erase-confirmation open state

Recommended local message shape:

- use the existing `AgentMessageRow` data for server messages
- augment local rendering with a small client-only status layer keyed by a temporary local id

### `AgentMessageBubble`

Responsibilities added:

- render optional message status metadata for user messages
- render a retry affordance for failed user messages

The assistant markdown rendering remains unchanged.

### `AgentPanelHeader`

Responsibilities added:

- render the anchored erase-confirmation popover
- keep `Erase` as the entry point for the confirmation flow

## Data Flow

### Send Flow

1. user submits text
2. panel creates optimistic user message with temporary id and `sending` status
3. optimistic message is appended locally
4. server action executes
5. success path:
   - optimistic entry is replaced or reconciled with the server-created user message
   - assistant and optional system messages append normally
6. failure path:
   - optimistic entry remains
   - status changes to `failed`
   - retry reuses the same content

### Clear Flow

1. user clicks `Erase`
2. local popover opens by the control
3. user confirms
4. server action clears the current thread
5. transcript resets on success

## Error Handling

- send failures do not remove the user's message
- retry should preserve the original content
- clear failures leave the existing transcript intact and only close the popover if explicitly desired
- if thread context is unavailable, send remains disabled as it is today

## Testing

Focused tests should cover:

- erase opens a styled confirmation flow instead of native confirm usage
- optimistic user message appears immediately after send
- optimistic message transitions to `sent` on success
- optimistic message transitions to `failed` on server error
- failed message exposes retry
- retry resubmits the original content

## Implementation Notes

- reuse existing panel visual tokens rather than introducing a new dialog system
- keep the state model local to the coworker panel for this slice
- avoid schema changes; this is a client interaction improvement layered onto the existing server actions
