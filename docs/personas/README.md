# DPF Persona Library

This directory holds persona case-study documents that serve two jobs at once:

- Marketing substrate: narrative, quotes, before/after copy, and concrete pain points that can be reused in site copy, decks, onboarding, and customer conversations.
- Test substrate: re-runnable dogfood scenarios that prove the platform still works for that persona as DPF evolves.

For the user-facing product framing that these personas support, see [Market Archetypes And Coworkers](../user-guide/market-archetypes.md). That page is the canonical narrative; persona files are proof and test fixtures, not a second product overview.

Each persona gets one Markdown file named `<name>-<vertical>.md`. The first real persona is [Dale, HVAC owner](dale-hvac.md), extracted from the Build Studio dogfood thread at [docs/dogfood/2026-05-23-dale-hvac-build-studio.md](../dogfood/2026-05-23-dale-hvac-build-studio.md) and the live `EP-9FC5D2FD` backlog state. The first vertical workspace-home peer wave is tied to the [Vertical Workspace Home design](../superpowers/specs/2026-05-24-vertical-workspace-home-design.md) and the live `EP-REDUCTION-GEAR-ARCH` backlog.

The current proof set intentionally spans three general market verticals: field service (Dale), healthcare scheduling (Linda), and retail merchandising (Marisol). New personas should keep that market-vertical discipline: they must show how the archetype changes the daily work surface, coworker emphasis, vocabulary, and reusable feature applicability.

## Library Rules

- Keep the persona voice concrete. Write from the operator's daily reality, not from platform capability names.
- Keep marketing and testing together. If a story claims value, the same file should say how to re-run the flow.
- Ground every dogfood finding in the dogfood log, live backlog, or source code. Do not invent shipped status from memory.
- Treat backlog snapshots as dated. Re-query the live backlog before gating new work on a persona file.
- Anchor every archetype to the catalog. Personas reference `StorefrontArchetype.archetypeId` and `category` strings that exist in `packages/storefront-templates/src/archetypes/`; if the natural leaf is missing, link the tracked work instead of implying it ships today.
- Anchor every coworker name to seed reality before a dogfood run. If a coworker is designed but not seeded, say so and simulate it through the generic build/chat flow.
- Before adding new Build Studio dogfood runs for peer personas, check Dale's D38 blocker (`BI-4396EFEC`). The referee patch shipped to `main` on 2026-05-24 as PR #1107 (`2eec3807`), but the BI remains `triaging` until a fresh Dale run confirms plan-iteration convergence. Peer runs are unblocked the moment that verification clears — they do not have to wait for the BI to be administratively closed.
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

## File template

Every persona file follows the shape pioneered by [Dale](dale-hvac.md). Sections in order:

1. `# <Name>, <role> at <business shape> - DPF persona`
2. `## Snapshot` — business, size, tech baseline, what they don't have, target archetype + category (anchor each to the catalog and note seed gaps), IT4IT value streams. State unknowns explicitly ("not specified in dogfood source") rather than fabricating.
3. `## The narrative (marketing-grade)` — 2-3 paragraphs in operator voice. No platform jargon.
4. `## What they ask DPF to build (the first feature)` — the operator's own sentence + a 3-5 bullet smoke scope + the `FB-*` build id under their hardening epic (or "no live build yet" if pre-dogfood).
5. `## What the platform needs to be like for them` — vocabulary expected/avoided, coworkers split into *seeded today* vs *spec-only / simulate via generic coworker*, critical features, mostly irrelevant at first touch, surfaces touched first, surfaces they should never see.
6. `## Marketing extractables` — punch quotes, before/after, feature soundbites, permission-to-use statement.
7. `## Test scenarios (re-runnable dogfood)` — each scenario links the `BI-*` it gates on.
8. `## Dogfood history` — dated table of phases reached, deficiencies surfaced, outcome. Pre-dogfood personas may omit this until a real run lands.
9. `## Open BIs from this persona's dogfooding` — dated snapshot of the live backlog query; mark the query date at the top of the table.
10. `## Source evidence` — dogfood log, architecture/spec grounding, exact MCP calls used to produce the snapshot, archetype catalog file, coworker seed file.

## Cross-references

- Repo rulebook: [`AGENTS.md`](../../AGENTS.md).
- Internal workspace substrate that will carry these personas day-to-day: [Vertical Workspace Home design](../superpowers/specs/2026-05-24-vertical-workspace-home-design.md).
- Field service worked example: [Field Service Trades design](../superpowers/specs/2026-05-19-field-service-trades-ai-dispatch-design.md) and [Field Service Sprint 1 plan](../superpowers/plans/2026-05-19-field-service-sprint-1.md).
- Archetype catalog (single source of truth for `archetypeId` / `category` strings): `packages/storefront-templates/src/archetypes/`.
- Coworker catalog (single source of truth for seeded coworker names and slugs): `packages/db/src/seed.ts`.
