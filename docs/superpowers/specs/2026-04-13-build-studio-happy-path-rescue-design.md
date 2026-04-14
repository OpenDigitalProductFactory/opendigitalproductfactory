# Build Studio Happy Path Rescue Design

**Date:** 2026-04-13
**Status:** Draft
**Author:** Codex for Mark Bodman

---

## Problem

Build Studio is trying to solve too many problems at once and does not currently provide a trustworthy end-to-end workflow.

The platform has several partial systems that individually look promising:

- feature intake and brief capture
- taxonomy suggestion and attribution
- backlog and epic tools
- ideate / plan / build / review / ship phases
- multiple execution engines (`agentic`, Codex CLI, Claude Code CLI)
- sandbox verification and QA

But they do not yet behave as one reliable operating path. The result is a high-friction experience:

- feature work does not reliably start from a persisted taxonomy/backlog/epic anchor
- the active execution engine is hard to reason about and failures are expensive to diagnose
- Build Studio still behaves like a black box even when the new process graph helps visibility
- failure recovery often feels like "start over" instead of "retry the failed step"
- manual testing burden remains high, especially for feature work that touches external tools

The immediate user pain is concrete:

1. A real feature request was attempted: improve portfolio discovery to capture real version numbers from Grafana and Prometheus.
2. The feature should have been tied to backlog and epics, but the workflow did not reliably do that.
3. Taxonomy association consumed hours of debugging and still did not feel trustworthy.
4. The build path repeatedly encountered tool and execution issues.
5. Manual validation consumed most of the day for one feature.

This is not primarily a "better model" problem. It is a happy-path architecture problem.

---

## Evidence From Current Project State

### Live backlog state

The live PostgreSQL database currently has:

- `0` epics in `Epic`
- `1` open backlog item in `BacklogItem`, unrelated to Build Studio feature delivery

This means the intended Build Studio governance flow is not presently reflected in runtime backlog state. A successful rescue must repair real platform behavior, not just documentation.

### Current Build Studio configuration

The live `PlatformConfig` entry `build-studio-dispatch` currently resolves to:

- `provider: "claude"`
- `claudeProviderId: "anthropic-sub"`
- `claudeModel: "opus"`

The live credential store shows working configured entries for:

- `anthropic-sub`
- `chatgpt`
- `codex`

So the platform already has viable CLI credentials. The primary issue is not "no provider configured"; it is that the overall Build Studio loop is still too fragmented.

### Current architectural tension

The codebase currently supports multiple overlapping paths:

- `apps/web/lib/actions/agent-coworker.ts`
- `apps/web/lib/integrate/build-orchestrator.ts`
- `apps/web/lib/integrate/claude-dispatch.ts`
- `apps/web/lib/integrate/codex-dispatch.ts`
- `apps/web/lib/routing/cli-adapter.ts`
- `apps/web/lib/mcp-tools.ts`

Important observation: the dedicated Build Studio dispatcher path now supports CLI execution directly, but the general `cli-adapter.ts` still contains the legacy "describe tools in prompt text" workaround rather than a fully unified MCP-native tool path. That is strong evidence that Build Studio still has split-brain behavior between coworker routing and build dispatch.

---

## Goal

Create one narrow, trustworthy, repeatable Build Studio happy path that can be used daily for real feature work.

For the first rescue slice, the platform must support:

`feature request -> taxonomy association -> backlog/epic linkage -> constrained plan -> single execution path -> targeted verification -> targeted retry`

Success is not "Build Studio looks advanced." Success is:

1. A user can request one small real feature and the platform anchors it to taxonomy and backlog before building.
2. Build Studio uses one deliberate execution engine for the run.
3. Verification is cheap and structured.
4. Failures do not force a full restart.
5. The workflow is observable enough that the user can tell what failed and what to retry.

---

## First Rescue Slice

The first rescue slice should use the user's real feature domain but cut the scope down aggressively:

### User-facing feature

"Improve portfolio discovery to capture one real version number from one external source."

### Scope constraints

- Start with **one** source: Grafana **or** Prometheus, not both
- Capture **one** version signal
- Persist or display that signal through the discovery/inventory flow
- Require taxonomy linkage before plan/build
- Require backlog item creation before plan/build
- Link to an existing epic when available, otherwise create or assign one during intake
- Provide one fixed verification routine for this slice

### Explicit non-goals for slice 1

- multi-source correlation
- generalized autonomous backlog portfolio planning
- broad portfolio discovery improvements
- advanced visual graph enhancements beyond what already exists
- broad reliability fixes across every Build Studio feature

The rescue slice exists to prove the operating path, not to finish the whole vision.

---

## Design Principles

### 1. One governed path before many smart paths

The platform should prefer one boringly reliable delivery path over multiple clever alternatives.

### 2. Intake is not optional metadata

Taxonomy, backlog item, and epic association are prerequisites for planning and execution, not "nice to have" enrichments.

### 3. Retry the failed step, not the entire feature

Build Studio must treat failure recovery as a first-class workflow.

### 4. Verification must be cheaper than implementation

If users spend most of their time manually testing the platform, the platform is not yet doing its job.

### 5. The user should be able to answer "what is it doing right now?"

Every stage must produce an inspectable result object and a clear stage status.

---

## Proposed Architecture

### Stage 1: Intake Gate

Before a feature can enter planning, Build Studio must persist:

- selected or confirmed taxonomy node
- backlog item
- epic linkage
- constrained feature goal for the current slice

This stage should fail fast when required context is missing.

If the user asks to "build" before these are set, the coworker should not improvise around the missing data. It should gather and persist them first.

### Stage 2: Planning Gate

Planning must produce a build plan tied to the persisted feature record and scoped to one measurable outcome.

For the rescue slice, acceptable outcomes should look like:

- "read one version string from Prometheus"
- "display one discovered version value on inventory detail"
- "store one discovered version in the discovery result"

Planning should reject broad goals such as "improve discovery" without narrowing.

### Stage 3: Execution Gate

Each build run must resolve one primary execution engine at the beginning and record it in run state.

No silent engine switching during the run.

For the rescue slice:

- the orchestrator remains the owner of task lifecycle
- one selected execution engine performs build tasks
- fallback is explicit and recorded, not implicit

### Stage 4: Verification Gate

Verification must be a fixed structured routine for the slice:

1. can connect to the selected discovery source
2. can fetch one version payload
3. can parse one version value
4. can persist or display the value at the intended platform surface

The output must identify the exact failing stage.

### Stage 5: Recovery Gate

After a failed run, Build Studio must allow:

- retry failed intake step
- rerun taxonomy linkage only
- rerun verification only
- rebuild one affected task only

Full rebuild should be explicit, not default.

---

## Components

### 1. Feature Intake Coordinator

**Responsibility:** enforce and persist intake prerequisites before planning.

Owns:

- feature scope text
- taxonomy node
- backlog item id
- epic id
- intake status

### 2. Happy Path Planner

**Responsibility:** generate a constrained build plan from a fully anchored intake record.

Owns:

- measurable outcome statement
- tiny file/task decomposition
- plan review state

### 3. Execution Dispatcher

**Responsibility:** lock the execution engine for the run and dispatch tasks consistently.

Owns:

- chosen engine (`claude`, `codex`, or `agentic`)
- engine metadata for the run
- explicit fallback reason if used

### 4. Discovery Worker

**Responsibility:** perform the external version lookup for the current slice.

Owns:

- source-specific fetch logic
- raw evidence capture
- normalized version result

### 5. Verification Runner

**Responsibility:** run the cheap fixed test routine and produce structured failure output.

Owns:

- connect/fetch/parse/persist stage checks
- compact verification summary

### 6. Recovery Controller

**Responsibility:** map failure state to the minimal safe retry path.

Owns:

- retryable stage classification
- failed-step-only reruns

---

## Data Model Direction

No large new subsystem is needed for the first rescue slice. The design should build on `FeatureBuild` and existing evidence fields.

The rescue slice needs a normalized, explicit state shape attached to the feature build workflow. At minimum:

```ts
type HappyPathState = {
  intake: {
    status: "pending" | "ready" | "failed";
    taxonomyNodeId: string | null;
    backlogItemId: string | null;
    epicId: string | null;
    constrainedGoal: string | null;
    failureReason?: string | null;
  };
  execution: {
    engine: "claude" | "codex" | "agentic" | null;
    source: "grafana" | "prometheus" | null;
    status: "pending" | "running" | "failed" | "done";
    failureStage?: "connect" | "fetch" | "parse" | "persist" | null;
  };
  verification: {
    status: "pending" | "running" | "failed" | "passed";
    checks: Array<{
      stage: "connect" | "fetch" | "parse" | "persist";
      passed: boolean;
      detail: string;
    }>;
  };
};
```

This can initially live inside an existing JSON field if needed, but the shape should be explicit in code and tests.

---

## User Experience

For the first happy path, the Build Studio UI should communicate only what the user needs:

- intake missing vs intake ready
- chosen taxonomy/backlog/epic anchors
- chosen execution engine
- current stage
- one-line failure reason
- next available retry action

The key behavior change is psychological as much as technical:

- users stop wondering whether the system remembered the feature context
- users stop guessing which engine is active
- users stop re-running entire builds to recover one broken step

---

## Verification Strategy

The rescue slice must define one cheap routine the user can trust.

### Minimum verification contract

For the selected source:

1. trigger the happy path from a feature request
2. confirm taxonomy/backlog/epic are persisted before plan/build
3. confirm one version value is retrieved from the chosen source
4. confirm the result is visible or persisted where expected
5. confirm a failed sub-step can be retried without restarting the whole run

### Test layers

- unit tests for intake-state helpers and dispatcher selection
- unit tests for retry classification
- unit tests for discovery result normalization
- one targeted integration test for the happy-path state transition
- affected platform QA phase updates for Build Studio and coworker behavior

---

## Risks

### Risk 1: Split execution paths remain active

If coworker routing and build dispatch still behave as separate systems, the happy path will remain inconsistent.

**Mitigation:** make the selected engine explicit in state and test for it.

### Risk 2: Taxonomy remains advisory instead of enforced

If taxonomy linkage is still optional in practice, governance drift will continue.

**Mitigation:** planning/build must be blocked until intake prerequisites are persisted.

### Risk 3: Verification becomes another expensive subsystem

If verification is too broad, it will recreate the same manual burden.

**Mitigation:** keep the rescue slice verification routine fixed and tiny.

### Risk 4: The first feature is still too large

Grafana + Prometheus + portfolio discovery + inventory UX is too large for one rescue slice if taken literally.

**Mitigation:** start with one source and one version signal.

---

## Recommended Implementation Order

1. Make intake prerequisites explicit and enforce them before planning
2. Add normalized happy-path run state for intake, execution, and verification
3. Lock and surface the selected execution engine for each run
4. Implement one tiny discovery worker path for one source
5. Add fixed verification and failed-step retry behavior
6. Extend the happy path to the second source only after the first path is stable

---

## Acceptance Criteria

1. Build Studio cannot enter planning until taxonomy, backlog item, and epic association are persisted.
2. A run records which execution engine it used.
3. The first rescue slice can fetch one real version value from one chosen source.
4. Verification reports the exact failed stage when the slice breaks.
5. The user can retry the failed stage without re-running the whole feature.
6. The path is backed by focused automated tests and a lightweight manual QA routine.

