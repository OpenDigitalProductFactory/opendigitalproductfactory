# DPF Persona Library

This directory holds persona case-study documents that serve two jobs at once:

- Marketing substrate: narrative, quotes, before/after copy, and concrete pain points that can be reused in site copy, decks, onboarding, and customer conversations.
- Test substrate: re-runnable dogfood scenarios that prove the platform still works for that persona as DPF evolves.

Each persona gets one Markdown file named `<name>-<vertical>.md`. The first real persona is [Dale, HVAC owner](dale-hvac.md), extracted from the Build Studio dogfood thread at [docs/dogfood/2026-05-23-dale-hvac-build-studio.md](../dogfood/2026-05-23-dale-hvac-build-studio.md) and the live `EP-9FC5D2FD` backlog state. The first vertical workspace-home peer wave is tied to the [Vertical Workspace Home design](../superpowers/specs/2026-05-24-vertical-workspace-home-design.md) and the live `EP-REDUCTION-GEAR-ARCH` backlog.

## Library Rules

- Keep the persona voice concrete. Write from the operator's daily reality, not from platform capability names.
- Keep marketing and testing together. If a story claims value, the same file should say how to re-run the flow.
- Ground every dogfood finding in the dogfood log, live backlog, or source code. Do not invent shipped status from memory.
- Treat backlog snapshots as dated. Re-query the live backlog before gating new work on a persona file.
- Anchor every archetype to the catalog. Personas reference `StorefrontArchetype.archetypeId` and `category` strings that exist in `packages/storefront-templates/src/archetypes/`; if the natural leaf is missing, link the tracked work instead of implying it ships today.
- Anchor every coworker name to seed reality before a dogfood run. If a coworker is designed but not seeded, say so and simulate it through the generic build/chat flow.
- Before adding new Build Studio dogfood runs for peer personas, check Dale's D38 blocker (`BI-4396EFEC`). As of 2026-05-24, it remains `triaging`; peer runs should wait until a fresh Dale run proves plan-iteration convergence.
- When a persona build ships a reusable feature, record its archetype applicability. Reusable does not mean useful for every business.

## Current Files

| Persona | Vertical | Archetype/category | Source state | Workspace-home BI | First feature smoke |
| ------- | -------- | ------------------ | ------------ | ----------------- | ------------------- |
| [Dale](dale-hvac.md) | HVAC / field service | target `hvac-contractor`; category `trades-maintenance` | Dogfooded through Build Studio phases, with live backlog items through D38 | `BI-CE6AF925` | Dispatch board plus truck-stock visibility |
| [Linda](linda-clinic.md) | Clinic scheduling | `dental-practice`; category `healthcare-wellness` | Defined from vertical-home design; not dogfooded yet | `BI-8954667A` | Appointment readiness and practitioner capacity |
| [Marisol](marisol-retail.md) | Retail merchandising | `retail-goods`; category `retail-goods` | Defined from vertical-home design; not dogfooded yet | `BI-3F3B535D` | Order tasks, low stock, receiving, returns, and location signals |

## Candidate Queue

These are queued until each has a grounded first-feature run or a deliberately scoped research pass:

| Candidate | Working role | Target category | Current backlog anchor |
| --------- | ------------ | --------------- | ---------------------- |
| Pat | Professional services operator | `professional-services` | `BI-57BC53E0` |
| Roberto | Food/hospitality owner-operator | `food-hospitality` | `BI-52E4939B` |
| Aaliyah | Education/training coordinator | `education-training` | `BI-134B247A` |
| Carmen | HOA/property operations coordinator | `hoa-property-management` | `BI-96A3C7A9` |
| Grace | Nonprofit program manager | `nonprofit-community` | `BI-EF03E915` |

Do not expand the persona library by inventing generic archetype stories. Each new file should be linked to a specific workspace-home backlog item or a real dogfood run.
