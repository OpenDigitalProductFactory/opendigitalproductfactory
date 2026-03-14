# Agent Resize, Sensitivity, and Form Assist Design

## Overview

The portal coworker needs to become a safer and more useful human-in-the-loop assistant. Today it is draggable and route-aware, but it is fixed-size, it cannot interact with forms in a structured way, and provider choice does not respect the sensitivity of the current page.

This design adds three linked capabilities:

- a resizable coworker panel with persisted size
- route-level data sensitivity metadata that constrains provider selection
- a per-user, per-page elevated assist mode that lets the agent fill approved form fields, but never submit them

The goal is to establish a reusable platform pattern rather than a one-off UX tweak.

## Current State

The relevant current code paths are:

- `apps/web/components/agent/AgentCoworkerShell.tsx`
  - fixed panel width and height
  - persisted open state and position only
- `apps/web/components/agent/AgentCoworkerPanel.tsx`
  - renders the header, messages, and input
  - no resize controls or elevated assist controls
- `apps/web/lib/agent-routing.ts`
  - picks the specialist agent for the route
  - does not consider page sensitivity or provider restrictions
- `apps/web/lib/actions/agent-coworker.ts`
  - sends route context into the agent action
  - does not include sensitivity or form-assist state

The portal already has route help and page-aware agent selection, so the new policy metadata should align with those route-driven mechanisms instead of introducing an unrelated config source.

## Goals

- Let users resize the coworker panel and remember the size per user.
- Classify each portal route by sensitivity using a simple platform-wide scheme:
  - `public`
  - `internal`
  - `confidential`
  - `restricted`
- Use the route sensitivity to constrain provider selection.
- Let users enable elevated form-fill assistance per user and per page.
- Show a visible yellow indicator in the agent header when elevated form-fill assist is active.
- Allow approved forms to expose structured field metadata so the agent can propose or apply values safely.
- Keep the human as the final approver by forbidding agent-driven submit in the first slice.

## Non-Goals

- No fully autonomous form submission.
- No arbitrary DOM scraping or browser automation by the agent.
- No full governance engine for provider policy in this slice.
- No role-based help variations in this feature.
- No cross-page standing permission model beyond per-user, per-route preferences.

## Sensitivity Model

Each page route gets one sensitivity level:

- `public`
- `internal`
- `confidential`
- `restricted`

For the first slice, this can live in route metadata alongside route help or route agent definitions.

Recommended provider policy:

- `public`
  - any enabled provider
- `internal`
  - local preferred, cloud allowed if not otherwise blocked
- `confidential`
  - local strongly preferred, cloud allowed only if policy permits
- `restricted`
  - local-only by default

This is intentionally simple. The point is to establish a platform-level policy seam that future governance logic can strengthen.

## Provider Selection Behavior

Agent routing should stop being purely route-to-specialist. It should become:

1. resolve route specialist agent
2. resolve route sensitivity
3. evaluate allowed provider set for that sensitivity
4. select the best available provider from the allowed set
5. if no provider is allowed:
   - fall back to read-only canned/help behavior
   - explain the restriction in the UI

This keeps public LLMs out of routes that should remain local-only.

## Resizable Panel Behavior

The coworker shell should support both drag and resize.

Requirements:

- panel remains draggable
- panel gains resize affordances, ideally bottom-right first
- size is persisted per user
- size is restored on reopen
- size is clamped to the viewport
- size is adjusted on window resize if the stored dimensions would overflow

For MVP, one resize handle is sufficient. The implementation should still keep the panel layout flexible enough that future multi-edge resizing is possible.

## Elevated Form-Fill Assist

Elevated form-fill assist is disabled by default and can be enabled per user per route.

Behavior:

- user enables elevated assist for a page
- the setting is remembered for that user on that route
- the agent header shows a yellow indicator while active
- the agent may fill structured form fields on approved forms
- the agent may not submit the form

The yellow indicator is not decorative. It is a privacy and authority cue that the page is currently allowing higher-impact agent interaction.

## Structured Form Assist Adapter

Forms should not expose raw DOM access to the agent. Instead, pages opt in with a structured adapter.

The adapter should define:

- route key
- form id
- allowed fields
- for each field:
  - field key
  - label
  - type
  - optional helper text
  - whether current value can be shared with the provider under the page sensitivity policy

The form assist workflow:

1. page registers a form assist adapter
2. user enables elevated assist
3. user asks the agent for help
4. the agent receives the structured form context
5. the agent returns structured field updates
6. the page applies those updates into the form state
7. the human reviews and submits manually

This keeps page code in control and avoids brittle automation.

## Persistence Model

The system needs lightweight persistence for:

- panel size per user
- elevated assist enabled per user per route

For the first slice:

- panel size can remain local client persistence if needed for speed
- elevated assist should be persisted in a user-aware way that survives device/browser changes if practical

If there is no existing user preference model yet, a small server-side preference store or a constrained route-keyed user preference table is preferable for elevated assist. That permission is more meaningful than a purely local UI preference.

## UI Changes

### Agent Header

Add:

- elevated assist toggle or control
- yellow elevated-assist indicator when active
- optional provider restriction explanation when the current page sensitivity limits provider choice

### Agent Shell

Add:

- resize handle
- persisted width and height
- clamped layout behavior

### Forms

Opted-in forms can expose:

- available field list
- field-fill action path
- optional “agent assisted” messaging near the form if helpful

## Error Handling

- If no allowed provider exists for the page sensitivity, the user should get a clear explanation and the agent should fall back to safe assistance.
- If elevated assist is enabled but the page has no registered form adapter, the agent should stay informational.
- If applying agent-suggested field updates fails validation, the page should preserve user edits and surface normal form validation messaging.
- If a provider is downgraded because of sensitivity restrictions, the system should say so clearly.

## Testing Strategy

Tests should cover:

- panel resize persistence and viewport clamping
- sensitivity metadata resolution by route
- provider filtering based on sensitivity
- elevated assist toggle persistence
- yellow header indicator rendering
- structured form adapter field application behavior
- guarantee that agent assist cannot submit forms in this slice

## Recommended First Slice

The first implementation slice should be:

1. add route sensitivity metadata
2. add provider filtering by sensitivity
3. add resizable panel with persisted dimensions
4. add per-user per-route elevated assist preference and header indicator
5. integrate one or two representative forms with the structured form-assist adapter

This order gives immediate user value while building the correct long-term platform controls.
