# Documentation Definition Of Done

Backlog item: BI-E99E15E1
Epic: EP-5560770F
Date: 2026-07-04
Status: implemented and merged via PR #2614 on 2026-07-05; BI-E99E15E1 done

## Context

DPF has the right documentation substrate (`docs/`, `docs/user-guide/`,
the public Jekyll site, and `prompts/specialist/documentation-specialist.prompt.md`),
but the delivery loop does not consistently route implementation work through
that substrate. Build Studio currently treats data, software, frontend, and QA
as the only build specialists. External Claude, Codex, and Grok task prompts
share a common specialist instruction path, but that path does not require a
documentation impact check before a coding task is reported done.

The public documentation standards checked for this slice reinforce the shape:
Diataxis separates documentation by user need (tutorial, how-to, reference,
explanation); Google developer docs emphasize clear, consistent technical
writing; GitHub Docs frames style/content decisions around what works best for
users. DPF's own mapping is: public site for pre-install orientation, user guide
for operator how-to/reference, architecture docs for explanation, and
`docs/superpowers` for implementation history.

## Substrate Findings

- `AGT-904` and `prompts/specialist/documentation-specialist.prompt.md` already
  exist. No new agent concept is needed.
- `apps/web/lib/integrate/task-dependency-graph.ts` owns the Build Studio
  specialist role union, file/task classification, and phase ordering.
- `apps/web/lib/integrate/sandbox/agent-cli-runtime.ts` builds the shared
  Claude/Codex/Grok specialist prompt, so one docs-discipline block reaches all
  three external CLI surfaces.
- `packages/db/data/agent_registry.json` and the route-persona prompts still
  describe four Build Studio sub-agents, so the seed/source-of-truth text is stale.
- `docs/_config.yml` publishes `docs/` to `https://opendigitalproductfactory.com`.

## Phase 1 - Wire Documentation Specialist Into Build Studio

Deliverables:

- Add `documentation-specialist` to the `SpecialistRole` union.
- Classify docs/user-guide/public-site/architecture/prompt/agent-rulebook work
  to the documentation specialist when task text or file paths indicate docs
  impact.
- Place documentation tasks after implementation and before synthetic QA, so
  docs can read the final touched files while QA still performs final checks.
- Add tests proving docs tasks route to the documentation specialist and run
  before QA.

Verification:

- `pnpm --filter web exec vitest run apps/web/lib/integrate/task-dependency-graph.test.ts`

## Phase 2 - Make Docs Impact Part Of Done Across External Agents

Deliverables:

- Update shared specialist instructions so Claude, Codex, and Grok coding tasks
  must perform a docs-impact check before final status.
- Add role-specific instructions for `documentation-specialist` covering public
  docs, user guide, architecture docs, coworker prompts, and doc-debt backlog
  filing.
- Update Build Studio phase prompts and route-persona prompts so planning and
  review require documentation evidence or a concrete no-docs-needed attestation.
- Update registry delegates/descriptions so `AGT-ORCH-300` and `AGT-WS-BUILD`
  name the documentation specialist.

Verification:

- Targeted unit test above for role routing.
- `pnpm --filter web typecheck` for prompt/type changes.

## Phase 3 - Current Documentation Sweep

Deliverables:

- Refresh top-level docs source-of-truth boundaries in `docs/README.md`.
- Refresh public site `docs/index.html` to surface current platform capabilities:
  Build Studio, external Claude/Codex/Grok agents, AI Workforce, WWMD/WWWD/WSID
  decision governance, edge/security/operations, and docs-as-part-of-done.
- Refresh `docs/user-guide/index.md`, Build Studio docs, AI Workforce docs, and
  agent development docs where they are stale against the current platform.
- Record any broad follow-up sweep that is too large for this branch as backlog
  rather than prose-only TODO.

Verification:

- Readability/link sanity by inspecting changed Markdown/HTML.
- Jekyll/public-site build if dependencies are available; otherwise report as
  unrun and rely on CI.

## Current Verification Evidence

- PR #2614 merged to `main` at merge commit `395f4795d3f69bb322c2df8327d82a47001bd3f2`.
- GitHub CI passed on the final PR head: Typecheck, Production Build, Unit
  Tests, ADP Integration Tests, Module Size Guard, Spec/Plan/Doc Gate,
  UX-Fit Gate, CodeQL, DCO, gitleaks, and policy guards.
- Local source checks before merge: `git diff --check`, targeted role-routing
  tests, and a module-size guard mirror for the files touched during CI cleanup.
- Earlier sandbox build evidence was superseded by fresh GitHub CI because the
  shared sandbox was later shown to be stale/drifted. Sandbox freshness is
  tracked separately from this documentation-DoD delivery path.

## Risks

- Public docs can become too implementation-heavy. Keep public pages oriented to
  what a user/operator can do, and push contributor mechanics to user-guide or
  architecture pages.
- A documentation specialist that always runs could add noise for invisible
  internal refactors. The classifier should trigger on docs paths, public/user
  behavior, prompts, route maps, install/ops docs, or explicit docs task text,
  while review prompts accept a no-docs-needed attestation for truly invisible
  changes.
- Adding a role to the union must be reflected in every `Record<SpecialistRole,
  ...>` map to avoid compile failures.

## Rollback

Revert this branch. It changes prompts, documentation, a pure task-routing
function, and seed registry data only; no migration or runtime data mutation is
introduced.
