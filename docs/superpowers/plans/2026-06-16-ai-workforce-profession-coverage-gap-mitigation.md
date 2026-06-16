# AI Workforce Profession Coverage Gap Mitigation

Backlog item: `BI-48B3CEC4`
Work capsule: `WC-CC0BD837`
Branch: `fix/mitigate-wsid-ai-workforce-profession-coverage-g`

## Gap

The AI Workforce page warned that all 82 coworkers had a profession coverage gap. Investigation found two source defects:

- Roster/detail resolution matched profession families from `Agent.slugId` or `Agent.agentId` only, while registry-seeded agents store the role slug in `Agent.name` and use `AGT-*` ids.
- The seed/corpus source left five hardcoded coworker roles unmapped and two registered profession families without wiki corpus pages.

Runtime backfill or UI suppression would hide the symptom but leave future installs broken. The selected WWMD path is source repair plus invariant coverage.

## Plan

1. Centralize profession-family lookup around the persisted Agent identity tuple: `roleSlug`, `slugId`, `agentId`, and `name`.
2. Use that shared resolver from both AI Workforce roster and coworker detail loading.
3. Bind every seeded coworker role to a profession family in `docs/professions/registry.json`.
4. Add first-party corpus pages and source metadata for the empty `build-studio` and `admin-operations` families.
5. Refactor hardcoded coworker seed rows/grants into importable seed constants, then test the constants directly instead of scraping `seed.ts`.
6. Add invariant tests that fail when a registered family has no corpus or any seeded coworker role lacks exactly one profession binding.
7. Verify with source-local tests, typechecks, production build, and local-integration UX evidence.

## Acceptance Evidence

- Source inventory after repair: 63 registry agents mapped, 18 hardcoded coworkers mapped, no duplicate role bindings, no empty profession families.
- Local corpus seed produced 150 published profession wiki pages, including four `build-studio` pages and four `admin-operations` pages.
- AI Workforce UX verification on `http://127.0.0.1:3001/platform/ai` showed no profession warning and no demand-queue warning text for the 82-coworker roster.
