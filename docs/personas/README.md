# DPF Persona Library

This directory holds persona case-study documents that serve two jobs at once:

- Marketing substrate: narrative, quotes, before/after copy, and concrete pain points that can be reused in site copy, decks, onboarding, and customer conversations.
- Test substrate: re-runnable dogfood scenarios that prove the platform still works for that persona as DPF evolves.

Each persona gets one Markdown file named `<name>-<vertical>.md`. The first real persona is [Dale, HVAC owner](dale-hvac.md), extracted from the Build Studio dogfood thread at [docs/dogfood/2026-05-23-dale-hvac-build-studio.md](../dogfood/2026-05-23-dale-hvac-build-studio.md) and the live `EP-9FC5D2FD` backlog state.

## Library Rules

- Keep the persona voice concrete. Write from the operator's daily reality, not from platform capability names.
- Keep marketing and testing together. If a story claims value, the same file should say how to re-run the flow.
- Ground every dogfood finding in the dogfood log, live backlog, or source code. Do not invent shipped status from memory.
- Before adding new Build Studio dogfood runs for peer personas, check live backlog for Dale's D38 blocker (`BI-4396EFEC`). At library creation time on 2026-05-24, it was still captured/triaging, so new persona Build Studio runs should wait.
- When a persona build ships a reusable feature, record its archetype applicability. "Reusable" does not mean "useful for every business."

## Current Files

| Persona | Vertical | Source state | First feature smoke |
| ------- | -------- | ------------ | ------------------- |
| [Dale](dale-hvac.md) | HVAC / field service | Dogfooded through Build Studio phases, with live backlog items through D38 | Truck stock tracker |

## Candidate Queue

These names are placeholders until each has a grounded first-feature run or a deliberately scoped research pass:

- Pat - professional services operator
- Linda - healthcare/wellness scheduler or clinic operator
- Roberto - food/hospitality owner-operator
- Marisol - retail or beauty/personal-care operator
