# AI Routing and UX Verification Test Architecture

| Field | Value |
| --- | --- |
| Status | Approved for slice 1 implementation |
| Created | 2026-05-11 |
| Author | Codex + Mark Bodman |
| Primary audience | Platform architecture, AI workforce, Build Studio, QA, release governance |
| Related repo areas | `apps/web/lib/tak/agent-routing.ts`, `apps/web/lib/tak/route-context-map.ts`, `apps/web/lib/tak/agentic-loop.ts`, `apps/web/lib/tak/agent-grants.ts`, `apps/web/components/agent/*`, `apps/web/lib/integrate/*`, `e2e/*`, `tests/e2e/platform-qa-plan.md`, `apps/web/vitest.config.ts`, `playwright.config.ts` |
| Related artifacts | `docs/superpowers/specs/2026-04-30-ai-coworker-operator-pattern.md`, `docs/superpowers/specs/2026-04-30-build-specialist-operator-contract.md`, `docs/superpowers/specs/2026-04-29-coworker-execution-adapter-substrate-design.md`, `docs/superpowers/specs/2026-04-02-build-process-orchestrator-design.md`, `docs/superpowers/specs/2026-03-17-agent-test-harness-design.md`, `docs/superpowers/plans/2026-04-28-coworker-and-routing-sequencing-plan.md`, `tests/e2e/platform-qa-plan.md` |

## Purpose

DPF needs a test architecture that specifically protects the surfaces where prior results have been weak:

1. routing the user to the right AI coworker
2. giving that coworker the right route context, skills, tools, and grants
3. proving the coworker behaves as an operator rather than a generic chat responder
4. proving the visible UI supports the workflow without overlap, hidden controls, dead ends, or misleading state
5. turning failed functional checks into backlog-ready evidence

The goal is not "more unit tests." The goal is a governed verification program where unit tests, route-contract tests, coworker behavioral tests, Playwright functional tests, and release evidence all point at the same product truth.

## Executive Decision

Create a dedicated testing epic for **AI Routing and UX Verification**, backed by this spec and the companion implementation plan.

This work should not be filed as a generic "unit and functional tests" epic. That title hides the real risk. The real risk is that DPF can pass code-level checks while routing a user to the wrong coworker, giving the right coworker stale prompt/tool state, or presenting a UI that looks plausible but does not let the user complete the workflow.

The architecture should use five layers:

1. **Static route contract tests** - deterministic Vitest tests for route to agent, route data, domain tools, grants, prompt identity, and expected skills.
2. **Coworker behavioral contract tests** - deterministic and model-probe tests for incomplete information handling, no fabricated success, short-confirmation continuation, and no repeated diagnosis.
3. **Functional UX smoke suites** - Playwright tests grouped by route family and user journey, with trace/screenshots retained on failure.
4. **Evidence normalization** - a small result schema that converts failures into backlog-ready evidence.
5. **Release gate integration** - affected QA phase runs become explicit completion evidence for Build Studio and release work.

At least 20 percent of the implementation budget should be spent on refactoring test fixtures and routing helpers before adding new broad coverage. The suite must be maintainable enough that future agents can extend it without duplicating brittle setup.

## Current Repo Truth

### Existing automated test substrate

DPF already has broad test coverage across:

- web Vitest tests through `apps/web/vitest.config.ts`
- db package Vitest tests through `packages/db/package.json`
- mobile tests through root `pnpm test`
- Playwright specs under `e2e/`
- a 15-phase manual/functional QA plan at `tests/e2e/platform-qa-plan.md`
- Build Studio UX verification state on `FeatureBuild.uxVerificationStatus` / `uxTestResults`
- endpoint/model behavior tests described in `docs/superpowers/specs/2026-03-17-agent-test-harness-design.md`

The current substrate is enough to build from. The gap is architecture and evidence discipline, not raw tooling availability.

### Existing route and coworker substrate

The main route/coworker sources are:

- `apps/web/lib/tak/agent-routing.ts` - resolves the route-facing coworker persona.
- `apps/web/lib/tak/route-context-map.ts` - declares route context, domain tools, and prompt snippets.
- `apps/web/lib/tak/agent-grants.ts` - maps tool names to grant categories.
- `packages/db/data/agent_registry.json` - declares agent records and grants.
- `prompts/route-persona/*.prompt.md` - route persona prompt bodies.
- `apps/web/components/agent/AgentCoworkerPanel.tsx` - visible coworker shell and event handling.

Prior specs already identify the failure mode:

- The Build Specialist operator contract documents a real case where a coworker refused callable tools because stale prompt text said the tool list was empty.
- The coworker sequencing plan says UI-visible coworker work must include route discovery and UX verification, not just code reasoning.
- The AI Coworker Operator Pattern says each coworker needs an operator contract, skill playbooks, tool surface, persistent work products, and UI surface.

### Existing UX functional plan

`tests/e2e/platform-qa-plan.md` is the right canonical inventory of user-facing functional expectations. It already includes:

- route-level expectations across 15 phases
- coworker-specific tests such as incomplete-info handling
- Build Studio UX verification checks
- authority/governance checks for tool execution and route-aware permissions
- a rule that failed QA tests create backlog items under the active QA epic

The weakness is that this plan is still partly manual and has no dedicated, current backlog epic visible in the live MCP query for this work.

## Problem Statement

DPF has been vulnerable to three compounding failure classes.

### Failure class 1: routing correctness without behavioral proof

A route can resolve to an agent and still fail the actual user workflow. Examples:

- route maps to a plausible but wrong specialist
- route context omits the data the coworker needs
- the tool list and grant catalog disagree
- prompt text describes stale runtime state
- a coworker repeats diagnosis instead of advancing work

### Failure class 2: UX checks that do not prove a usable surface

Unit and component tests can pass while:

- a control is hidden below a docked coworker panel
- long metadata pushes headers out of bounds
- a route redirects to a setup/login page and the test never notices
- a page renders a main panel but leaves the user without the next action
- a coworker response claims work happened but the surface shows no saved artifact

### Failure class 3: failed tests without operational closure

The platform QA plan says failures should become backlog items. In practice, failures are still too easy to leave as chat output, terminal logs, or unlinked screenshots.

The fix is to make test evidence a first-class path into backlog triage.

## Research and Benchmarking

### Repo benchmarks

Patterns to keep:

- `tests/e2e/platform-qa-plan.md` already uses stable functional IDs such as `BUILD-20` and `AUTH-GOV-11`.
- Build Studio already persists UX verification status and screenshot evidence.
- The endpoint test harness spec treats model behavior as evidence, not description.
- The operator-pattern specs require persisted work products and visible UI state, not chat-only success.

Patterns to change:

- Manual QA cases that are high-risk should become runnable smoke tests.
- Test command examples should use pinned workspace commands through `pnpm --filter ... exec ...`, matching `AGENTS.md`.
- Functional test failures should be normalized into evidence records instead of staying as one-off Playwright artifacts.

### External benchmarks

Playwright's official docs support the architecture in three places:

- Projects let one config define multiple independently runnable suites, which fits DPF's route-family smoke groups. See [Playwright projects](https://playwright.dev/docs/test-projects).
- Fixtures support reusable setup and teardown, and attachments can be added to reports, which fits DPF's login, route, and evidence helpers. See [Playwright fixtures](https://playwright.dev/docs/test-fixtures).
- Trace retention on failure provides browser-state evidence without storing heavy artifacts for every pass. See [Playwright trace viewer](https://playwright.dev/docs/trace-viewer).

Vitest's official docs support keeping route contracts deterministic:

- `vi.stubGlobal` and mocked modules are appropriate for route, prompt, and grant tests where no browser is needed. See [Vitest mocking globals](https://vitest.dev/guide/mocking/globals.html).
- Vitest supports DOM environments such as jsdom for component-level checks that do not need a full browser. See [Vitest features](https://vitest.dev/guide/features).

Testing Library's guiding principles remain useful for component tests: tests should resemble how users interact with the UI where practical. See [Testing Library guiding principles](https://testing-library.com/docs/guiding-principles/).

Patterns adopted:

- route-family Playwright projects
- fixtures for login, seeded state, route opening, coworker panel operations, and evidence attachment
- failure-only traces and screenshots
- deterministic Vitest route contracts before model-dependent behavior probes
- backlog-ready evidence as a test output

Patterns rejected:

- generic coverage targets as the epic goal
- one large Playwright suite with shared mutable state
- model-only behavioral testing without static route/tool/prompt contract checks
- screenshots as proof when the test did not assert the workflow outcome
- tests that pass by checking text while the route is unauthenticated or redirected

## Architecture

### Layer 1: Route Contract Matrix

Add a code-owned matrix that defines the canonical contract for high-risk routes.

Each contract includes:

- route pattern
- expected agent id
- expected display label
- required route context key
- required domain tools
- required grant categories
- expected prompt source
- expected skills or playbooks
- required visible UI evidence surface
- manual QA IDs covered by this contract

The first route set (route → repo-truth agent, verified against `apps/web/lib/tak/agent-routing.ts` 2026-05-11):

| Route family | Initial routes | Repo-truth agent | Why first |
| --- | --- | --- | --- |
| Build Studio | `/build`, `/platform/ai/build-studio` | `build-specialist` / "Software Engineer" | highest agent-routing and UX risk |
| Ops/backlog | `/ops` | `ops-coordinator` / "Scrum Master" | backlog actions must be governed and auditable |
| Discovery | `/platform/tools/discovery` | `inventory-specialist` / "Digital Product Estate Specialist" | specialist identity and evidence framing have known gaps (see AI-15 in QA plan) |
| Storefront | `/storefront`, `/storefront/setup`, public inquiry path | `storefront-advisor` / "Storefront Operations Manager" | user-facing UX and customer-zero intake |
| Marketing | `/customer/marketing`, `/customer/marketing/strategy` | `marketing-specialist` / "Marketing Strategist" | distinct from storefront — uses `save_marketing_review` operator pattern |
| Platform AI | `/platform/ai`, `/platform/ai/authority`, `/platform/ai/assignments`, `/platform/ai/routing` | `platform-engineer` / "AI Ops Engineer" | route/tool/authority visibility |
| Finance tax | `/finance/settings/tax` | `finance-agent` / "Finance Specialist" | coworker routing plus operational state visibility |

The contract matrix must be small enough to review. It is not a second route map. It is a test-facing assertion layer over the existing route map.

Required tool names per route must be **discovered from the route map**, not asserted from memory. Some MCP tool names exist in `mcp-tools.ts` / `agent-grants.ts` without being surfaced to a route's `domainTools` (e.g. `run_discovery_triage`, `record_tax_execution_outcome`); the contract test must distinguish "tool exists in the platform" from "tool is wired to this route." Asserting an unwired tool produces a false-negative test that looks like a coverage gap but is just plan-vs-reality drift.

### Layer 2: Static Contract Tests

Vitest verifies that each route contract resolves correctly. **Names are repo-canonical** — the spec must match the symbols actually exported, not aspirational ones:

- `resolveAgentForRoute(route, { platformRole, isSuperuser })` (from `apps/web/lib/tak/agent-routing.ts`) returns the expected agent. The user-context argument is required; the resolver gates `canAssist` on the user's `platformRole`. The route contract matrix therefore declares **expected agent per route** *and* **expected `canAssist` per role tier** (at minimum: superuser true; ops-user where access is route-appropriate; null-role where access must be denied). Existing role-conditional assertions in `apps/web/lib/tak/agent-routing.test.ts` are not absorbed into the matrix — they continue to live alongside it; the matrix layers a high-risk-route summary on top.
- `resolveRouteContext(route)` (from `apps/web/lib/tak/route-context-map.ts`) returns the expected context and domain tools.
- Every domain tool maps to a known grant where a grant is required. Use `getToolGrantMapping()` (function — there is no `TOOL_TO_GRANTS` constant) from `apps/web/lib/tak/agent-grants.ts` to look up the mapping; per-agent grants come from `getAgentToolGrants(agentId)`.
- Prompt files do not contain stale runtime state such as "currently empty tools" unless explicitly tagged as a future-state note. Note: route-persona prompt content is currently held inline in `agent-routing.ts` (the `systemPrompt` field on each route map entry), with `prompts/route-persona/*.prompt.md` as the migration target — the test asserts both surfaces consistently.
- Required skill/playbook references exist.
- Route contracts reference real QA IDs from `tests/e2e/platform-qa-plan.md`.

These tests are deterministic and should run in the normal web unit gate.

### Layer 3: Coworker Behavioral Tests

Behavioral tests split into two categories.

Deterministic tests:

- prompt structure contains operator-contract clauses
- short confirmations map to continuation state
- route context builder includes the page data needed by the coworker
- zero-tool-call and tool-refusal guards create platform issue reports where already implemented
- incomplete-info canned or deterministic flows ask for missing data rather than fabricating

Model-probe tests:

- no fabricated success when write tools are unavailable
- correct tool call when side-effecting tool is available and approved
- no repeated diagnosis after saved work exists
- concise next-step response after failed tool use

Model-probe tests should use the existing endpoint test harness pattern. They are evidence, not the sole release gate.

### Layer 4: UX Functional Smoke Suites

Playwright smoke suites should be grouped by route family, not by implementation file.

Initial projects:

- `auth-workspace`
- `build-studio`
- `ops-backlog`
- `platform-ai`
- `discovery`
- `storefront`
- `finance-tax`

Each smoke test must assert:

- the route loaded without redirecting to the wrong surface
- the expected shell/nav/chrome is present
- the expected agent label is visible when the coworker panel opens
- the user can identify the next action
- the workflow writes or displays the expected persisted state
- screenshots/traces are attached on failure

The smoke suite should prefer fewer, higher-value tests over a large brittle suite.

### Layer 5: Evidence and Backlog Loop

Add a normalized evidence artifact for functional failures.

Minimum fields:

- `testId`
- `suite`
- `route`
- `expected`
- `actual`
- `screenshotPath`
- `tracePath`
- `userRole`
- `agentId`
- `routeContext`
- `buildId` or `backlogItemId` where applicable
- `likelyOwnerArea`
- `reproCommand`

In the first implementation slice, write this artifact as JSON under Playwright test results. In a later slice, call the governed MCP/backlog surface or a platform API to create/link a backlog item.

Do not write raw SQL fallback as the normal path for test failure ingestion.

## UX Design Requirements

This epic is explicitly UX-heavy.

Functional UX tests should verify:

- no duplicate sub-navigation on tested route families
- no hardcoded color regression in new test-facing UI or evidence surfaces
- no controls hidden behind the docked coworker panel
- long titles, branch names, IDs, and route labels wrap or truncate predictably
- the first screen of a tested workflow presents the actual work surface, not a marketing-style landing page
- the next action is visible after success, failure, or partial completion
- in-app copy distinguishes runtime truth from future-state or configuration guidance

If a route fails these checks, the failure is a product bug, not just a flaky test.

## Refactoring Budget

The first two implementation slices reserve 20 percent of engineering effort for test architecture cleanup.

Allowed refactoring:

- shared Playwright fixtures for auth, app URL resolution, route opening, and evidence attachment
- route contract data structure for tests
- shared helpers for coworker panel opening and agent-label assertions
- shared assertions for "not redirected to welcome/login"
- typed evidence JSON writer
- small route-context test helper that prevents duplicated expectations

Out of scope refactoring:

- redesigning the entire agent-routing subsystem
- moving route maps to a new data model
- replacing the Build Studio orchestration substrate
- creating a new test runner
- broad visual redesigns unrelated to tested workflows

## Backlog Shape

Recommended epic:

**AI Routing and UX Verification Test Architecture**

Recommended items:

1. **Spec and route-contract inventory** - this spec plus the initial route contract matrix.
2. **Static route/coworker contract tests** - deterministic Vitest coverage for route, agent, tools, grants, prompts, and QA ID links.
3. **Playwright smoke fixtures and high-risk route suites** - route-family projects with login, evidence, and failure artifacts.
4. **Coworker behavioral probes for routing-sensitive flows** - incomplete info, no fabrication, short-confirmation continuation, and tool-refusal behavior.
5. **Functional failure evidence to backlog loop** - normalized artifacts first, governed backlog creation/linking second.

## Acceptance Criteria

- A reviewer can open one spec and one plan and see why the work is about AI routing and UX, not generic coverage.
- The initial route contract matrix includes Build Studio, Ops/backlog, Discovery, Storefront, Platform AI, and Finance tax.
- Unit-level route tests fail when a route maps to the wrong agent or loses a required domain tool.
- Prompt/tool/grant tests fail when prompt text describes stale runtime state or a route tool lacks the expected grant mapping.
- Playwright smoke tests fail when a route redirects to login/welcome unexpectedly.
- Playwright smoke tests capture route, agent, screenshot, trace, and repro command on failure.
- At least one Build Studio smoke flow proves the coworker-visible UI stays usable with the coworker panel open.
- At least one Discovery smoke or behavioral test proves the Estate Specialist uses the four-signal framing called out by `AI-15` in the QA plan.
- At least one Ops/backlog smoke flow proves a coworker-created backlog action is visible in ToolExecution/audit evidence.
- The plan includes explicit refactoring tasks before broad coverage expansion.

## Non-Goals

- Full release automation for all 15 QA phases in the first PR.
- Replacing manual exploratory QA.
- Adding a new external test platform.
- Rewriting every route persona prompt.
- Making model-probe tests hard merge gates before their stability is proven.
- Direct DB mutation as the normal backlog failure path.

## Open Decisions

1. ~~Whether the first backlog item should create the epic through the MCP surface before code begins, or whether the spec/plan PR should land first and the backlog item should reference it afterward.~~ **Resolved 2026-05-11.** Spec + plan land first; the implementation plan's Task 0 looks up an existing epic via `list_epics` and either reuses it or asks the chief architect whether to create a new one from the reviewed artifacts. Avoids a half-formed epic dangling if the spec is revised.
2. Whether route-family Playwright projects should live in the root `playwright.config.ts` or a dedicated `playwright.functional.config.ts`. Default proposal: extend the root config (single source of truth, fewer divergent project lists). Revisit only if shared helpers cause cross-suite coupling.
3. Whether failed functional evidence should first write local JSON only, or immediately call a governed in-app API that records `BacklogItemActivity`. Default proposal per the plan slicing: local JSON in slice 1; governed-API write in the follow-up slice (Task 8 of the plan), so direct DB fallback is never the normal path.
4. Whether model-probe tests run only on demand at first or as nightly non-blocking checks. Default proposal: on-demand only in slice 1; nightly non-blocking once the eval-cost budget is set (probe tests touch the LLM provider — uncapped scheduled use is a cost surprise). Tied to the same scheduling decision as the Build Studio dpf-native eval suites.

## Maturity Gates Before Implementation

This spec was reviewed and approved for slice 1 implementation on 2026-05-11 after the route-contract matrix, repo-canonical agent/tool names, and implementation guardrails were updated.

- [x] Spec reviewer (chief architect) signs off on the route-contract matrix and the agent/route truth table above.
- [x] Open Decisions 2–4 above resolved or explicitly deferred to the named follow-up slices.
- [x] Acceptance Criteria reviewed against the implementation plan's task list (no acceptance criterion lacks a task that produces evidence for it).
- [x] Plan's Task 0 backlog hygiene confirms either an existing epic or an explicit decision to create one from the reviewed artifacts.

Implementation tasks must not start before all four boxes are checked, OR the chief architect explicitly waives the gate for slice 1 on the basis that the slice is additive (no schema, no production UI behavior change, rollback = revert one PR).
