---
title: CI evidence impact planner — shadow-mode implementation
date: 2026-07-27
status: active
backlog: BI-A4EC0EA6
epic: EP-CODE-GRAPH
spec: docs/superpowers/specs/2026-07-26-ci-evidence-efficiency-design.md
coverage_receipt: cms3ocv0p0i3f01p5hjqigijf
---

# CI evidence impact planner

**For agentic workers:** execute this plan one independently reviewable backlog
item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green
implementation, `dpf-local-merge-ci-before-push` plus the plan's completion
gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Implement the shared, deterministic evidence planner from
`BI-A4EC0EA6` in shadow mode. Local-CI and GitHub CI will produce the same
versioned semantic plan for the same base tree, head tree, policy, and advice
inputs. Existing exhaustive test, typecheck, build, migration, guard, and merge
queue execution remains unchanged in this slice.

The plan recommends impacted tests, packages, routes, UX mode, and global
guards. Any missing, stale, dirty, incompatible, ambiguous, or unmapped input
expands the recommendation to exhaustive evidence. `unknown` never means
`skip`.

## Design grounding and architecture review

The merged umbrella spec and plan were reconciled with:

- `scripts/ci-change-scope.mjs`, the current GitHub change classifier;
- `scripts/lib/local-integration-ci.mjs`, the canonical local merged-code plan;
- `apps/web/lib/integrate/code-graph-access.ts` and
  `apps/web/lib/integrate/code-graph/graph-queries.ts`, the existing graph
  freshness and `TESTED_BY` contracts;
- the existing route manifest and route-family registries;
- the merge-readiness contract, which keeps `merge_group` exhaustive.

Architecture review: **aligned with guardrails**.

1. Code-graph advice is a versioned planner input, not a hidden runtime
   dependency. It is trusted only when the graph is `ready`, clean,
   structurally healthy, and indexed at the exact head tree. Commit SHAs remain
   provenance but do not invalidate advice when a synthetic merge commit has
   the same tree. GitHub may omit
   the advice input; runtime-source changes then expand to exhaustive evidence.
2. The digest covers semantic inputs and output only. Timestamps, host paths,
   logs, and other volatile diagnostics live outside the digested plan.
3. Every changed production file receives an explicit disposition:
   `mapped-tests`, `global-risk`, `coverage-observation`, or `unmapped`.
   `unmapped` selects exhaustive evidence and is visible in the report.
4. The current docs-only exemption is preserved because it does not narrow
   runtime evidence. Missing graph data does not turn a documentation-only
   change into a full web build. Runtime-source selection still fails safe.
5. Route ownership reuses committed route/manifest substrate; the planner does
   not create a second route registry.

Standards reviewed:

- Vitest `related` / `--changed`: static import relationships are useful seeds,
  but dynamic imports require explicit full-run triggers.
- Nx affected: use the Git diff plus dependency ownership and reverse
  dependencies, with explicit base/head identities.
- GitHub merge queues: required workflows must run on `merge_group`; DPF keeps
  that event exhaustive.
- The merged DPF design's Launchable/Develocity benchmark: shadow observation
  and an exhaustive safety net precede any skipping.

## Backlog coverage

- Decision: `atomic`
- Parent: `BI-A4EC0EA6`
- Receipt: `cms3ocv0p0i3f01p5hjqigijf`
- Rationale: the versioned core plus both local and GitHub consumers must land
  together. A core without both adapters is dead competing substrate; one
  adapter without the other violates parity.
- `planner-contract` — not independently shippable; dependencies: none.
- `surface-adapters` — not independently shippable; depends on
  `planner-contract`.
- `shadow-evidence` — not independently shippable; depends on both prior
  phases.

## Phase 1 — test-drive the planner contract

Create:

- `config/ci-evidence-policy.json`
- `scripts/lib/ci-evidence-plan.mjs`
- `scripts/lib/ci-evidence-plan.test.mjs`
- `scripts/fixtures/ci-evidence/`

Red tests define:

- stable schema version, policy version, and canonical SHA-256 digest;
- byte-stable semantic output regardless of input ordering;
- docs-only, mobile-only, web leaf, route, test-only, package, and DB inputs;
- package ownership, colocated tests, supplied Vitest-related tests, supplied
  graph `TESTED_BY` recommendations, and route families;
- exact-tree/clean/ready graph trust;
- exhaustive expansion for missing/stale/dirty/incompatible graph on runtime
  source, workflow/security/migration/lockfile/test-config/auth/routing-shell/
  shared-setup/install/seed/generated-contract changes, unmapped production
  files, planner errors, and selection-size thresholds;
- merge-group and non-PR events always exhaustive;
- explicit per-file dispositions and missing-test-update observations;
- timestamps and host paths do not affect the semantic digest.

Implement only enough pure Node logic to make those contracts green. The core
accepts already-resolved file lists and advice; it does not call Git, Vitest,
Neo4j, MCP, or GitHub.

## Phase 2 — one CLI and compatibility adapter

Create `scripts/ci-evidence-plan.mjs` to:

- resolve base/head commits and immutable tree SHAs;
- read changed paths from Git or newline-delimited stdin;
- load the checked-in policy and optional versioned advice JSON;
- emit canonical JSON to a file/stdout and a concise human summary;
- write GitHub outputs when requested.

Refactor `scripts/ci-change-scope.mjs` into a compatibility adapter over the
planner. Preserve its `heavy` and `mobile` outputs for existing jobs; remove its
duplicate path classification rules. Keep `classifyChangedFiles` as a stable
adapter export until all callers migrate.

Red-green verification:

- existing `ci-change-scope` tests remain green;
- local and GitHub CLI fixtures produce the same plan bytes and digest;
- malformed policy/advice/diff input returns a valid exhaustive plan, not an
  empty plan or an unhandled selector error;
- docs-only output remains light and non-runtime.

## Phase 3 — shadow consumers

Update `.github/workflows/ci.yml`:

- the existing `changes` job invokes the planner;
- publish plan JSON/digest/selection summary as shadow evidence;
- retain all current execution decisions except the already-existing docs and
  mobile compatibility outputs;
- force merge-group/non-PR plans to exhaustive.

Update `scripts/lib/local-integration-ci.mjs` and its tests:

- add the same planner command before exhaustive Vitest/typecheck/build;
- bind the plan to the exact integration tree and policy digest;
- keep the actual local-CI command list exhaustive.

The local/GitHub consumers must not duplicate risk rules. Workflow YAML and the
local integration plan only pass identities and consume the planner output.

## Phase 4 — reporting, docs, and refactor

Create/update:

- `docs/testing/ci-evidence.md`
- `docs/superpowers/specs/2026-07-26-ci-evidence-efficiency-design.md`
- relevant contract tests for CI workflow wiring.

Document the schema, graph-advice envelope, fail-safe reasons, digest boundary,
shadow-only semantics, and the future activation gate owned by `BI-4527C1DA`.
No operator-facing portal docs or UX changes are required.

The required 20% refactoring allocation is spent inside this slice:

- replace the duplicate `ci-change-scope` classifier with one adapter;
- centralize stable JSON/digest code in the planner;
- centralize risk rules in policy plus one evaluator;
- keep workflow/local surfaces as thin consumers.

Do not refactor shard balancing, build reuse, TypeScript duplication, policy
jobs, or CodeQL here; those remain `BI-4DB73C5E`.

## Completion gate

1. Planner and scope-adapter Node tests pass, including every expansion rule.
2. The same fixture produces byte-identical semantic output and digest through
   local and GitHub CLI modes.
3. Missing/stale/dirty graph, unknown files, and planner errors produce
   exhaustive plans.
4. Merge-group and push plans remain exhaustive.
5. GitHub and local-CI continue running their current exhaustive evidence; no
   test is skipped because of this PR.
6. The full governed `pnpm run pregate` passes for the exact candidate SHA,
   including typecheck, migrations/guards/docs, full tests, and production
   build.
7. `pnpm pr:health` reports every GitHub check terminal/pass, mergeable, and
   zero unresolved threads before queue enrollment.
8. Documentation impact is recorded. UX and migration are not applicable:
   this is CI developer tooling with no UI or schema change.

## Risks and rollback

| Risk | Prevention | Rollback |
| --- | --- | --- |
| Planner silently narrows on bad input | exhaustive result is the error value; table-driven tests | switch the `changes` job back to the adapter's previous full behavior |
| Local/GitHub drift | one pure core, canonical serializer, parity fixtures | remove both thin consumers together |
| Volatile digest | semantic/diagnostic split and ordering tests | bump schema and invalidate observations |
| Graph advice from wrong tree | exact head tree + clean/ready/relationship checks | omit graph advice and run exhaustive |
| Docs-only regression | compatibility fixture preserves current exemption | restore the prior adapter while planner remains shadow-only |
| Missing test ownership is hidden | explicit per-file dispositions and unmapped list | exhaustive evidence plus a visible observation |
