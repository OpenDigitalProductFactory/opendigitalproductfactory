# Implementation Plan — AI Coworker HRIS Management Surface

- **Spec:** `docs/superpowers/specs/2026-06-13-ai-coworker-hris-management-surface-design.md`
- **Epic:** EP-AI-WORKFORCE-001 (Phase 5+ UI), absorbing EP-WSID content surfacing.
- **Substrate:** zero new tables/enums/migrations. Read/aggregation layer + IA refactor only.
- **Architecture review:** advisory pass folded in (compose `loadCoworkerProfile`; persist
  variant axes into `WikiPage.metadata` in the seed).

## Constraints

- Theme tokens only (`--dpf-*`); migrate touched hex chips, no repo-wide hex sweep.
- Reuse existing access checks (`view_platform` / `manage_platform`); no new permission keys.
- New code composes existing helpers (`loadCoworkerProfile`, `resolveProfessionProfile`,
  `AgentModelRoutingCard`, `getAgentGrantSummaries`, `getAgentGaidMap`).
- Worktree has no node_modules; typecheck via CI / root-clone toolchain before push.

## Phase 0 — substrate enablement

1. `packages/db/src/seed-profession-corpus.ts`: in the page upsert (Pass 1, ~L834), persist
   `{ professionJurisdiction, professionCompetencyLevel }` into `WikiPage.metadata` (merge into
   existing metadata json; default `["global"]` / `practitioner` when omitted, matching
   `tallyVariantCoverage`). No schema change (`metadata Json?` exists).
2. `apps/web/lib/coworker-record/registry.ts`: load `docs/professions/registry.json` server-side
   into a family↔role index (`familyForRole(agentNameOrSlug)`, `rolesForFamily`, `familyLabel`,
   `coverageChecklist`, `sources`). Mirror `resolve-profession-profile.ts`'s registry read.
3. `apps/web/lib/coworker-record/coverage.ts`: `loadProfessionCoverage(professionKey)` →
   `{ jurisdiction: Record<jur,count>, competency: Record<level,count>, pages, checklistGaps }`,
   querying `WikiPage` (slug prefix `professions/<key>/`) + `metadata`.
4. Tests: parity of `loadProfessionCoverage` vs a fixture matching `tallyVariantCoverage`;
   registry index resolves every registry role (WSID §4.11 "every role resolves").

## Phase 1 — coworker record (highest value)

5. `apps/web/lib/coworker-record/load-record.ts`: `loadCoworkerRecord(idOrSlug)` composing
   `loadCoworkerProfile` + profession profile (`resolveProfessionProfile`) + `loadProfessionCoverage`
   + bound `DecisionPerspectiveProfile`/`VoiceProfile` + recent `DecisionInteraction` tally
   (recommend/arbitrate/escalate/defer over a window).
6. Refactor `apps/web/app/(shell)/platform/ai/agent/[agentId]/page.tsx` from flat scroll into a
   tabbed record (client tab shell `CoworkerRecordTabs.tsx`), tabs per spec §6:
   Overview · Profession & Knowledge (WSID) · Capabilities · Governance · Performance & Improvement ·
   Decisions & Activity. Reuse `AgentModelRoutingCard` in Capabilities. Migrate header chips to tokens.
7. New tab components under `apps/web/components/platform/coworker-record/`:
   `OverviewTab`, `ProfessionTab` (coverage matrix + materials + corpus links + lint badge),
   `CapabilitiesTab` (skills/grants/routing/voice), `GovernanceTab`, `PerformanceTab`
   (perf + self-assessment trend + open needs), `DecisionsTab`.
8. Tests: `loadCoworkerRecord` joins only existing models (no new prisma model referenced);
   coverage matrix renders; link-walk on a seeded fixture (no dead links).

## Phase 2 — roster directory + filters

9. `apps/web/lib/coworker-record/roster.ts`: `loadRoster(filter)` over agents + registry family
   map + coverage + provider health + open blockers + defer rate.
10. `apps/web/app/(shell)/platform/ai/page.tsx`: add filter rail (value-stream/department,
    profession family, competency, jurisdiction, lifecycle, coverage-gap) + family grouping mode +
    fitness badges. Keep tier grouping as default view.
11. Tests: filter predicates; unmapped-role + coverage-gap states surface.

## Phase 3 — enrich linked surfaces

12. `/wiki/perspectives`: add friendly profession label (from registry) + back-link to owning
    coworker(s) for `kind="profession"` rows.
13. `/platform/ai/founder-review`: add `?profession=` / `?agent=` filter param; record Decisions
    tab deep-links scoped.
14. ProfessionTab corpus-health badge → `/admin/wiki/lint` filtered by the family's slug scope.

## Phase 4 — decisions/defer signals

15. Record Decisions tab: full interaction list + defer breakdown (corpus-gap demand signal).
16. Roster: defer-rate fitness column; coverage-gap "demand queue" sort.

## Verification

- Per AGENTS.md §5: affected vitest, `pnpm --filter web typecheck`, `next build` (via CI given
  worktree has no node_modules). Functional drive deferred to the holistic verification thread
  (portal destroyed/redeployed per archetype, per operator directive).
- DCO `-s` on every commit; branch off origin/main; one concern per PR (phase-sized).
