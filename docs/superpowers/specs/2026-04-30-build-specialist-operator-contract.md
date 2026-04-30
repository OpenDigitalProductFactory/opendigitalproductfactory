# Build Specialist Operator Contract

| Field | Value |
| - | - |
| Status | Draft |
| Date | 2026-04-30 |
| Pattern | [AI Coworker Operator Pattern](./2026-04-30-ai-coworker-operator-pattern.md) (wave 1: Marketing Strategist, lands on main from the `coworker-marketing-recovery` worktree before this wave starts) |
| Scope | Apply the AI Coworker Operator Pattern to the user-facing Build Studio coworker (`AGT-WS-BUILD` / `build-specialist`) as wave 2 |
| Exemplar precedent | Marketing Strategist (wave 1) |

This spec is a domain instance of the canonical operator pattern. It does not redefine the pattern; it applies it. Read the pattern spec first.

## 1. Problem

Today's Build Studio E2E test (BI-E9CD1B92, FB-2A2C2AC5) failed at phase 1. Evidence:

- Build-specialist (`AGT-WS-BUILD`, model `claude-haiku-4-5`) ran three iterations of the agentic loop with **0 tool calls**, despite the runtime delivering 21 callable tools including `start_ideate_research`, `saveBuildEvidence`, `save_phase_handoff`.
- Agent text response: *"**Blocker**: start_ideate_research is not available in the current runtime... currently `[]`."* — a near-verbatim quote of stale text in [build-specialist.prompt.md:64](../../../prompts/route-persona/build-specialist.prompt.md).
- Three iterations, zero tool calls, permission-seeking nudge fired, 0 work products saved, 0 process issues filed.
- The user (operating the test) saw a polished refusal message and no indication anything had gone wrong.

Mapping to the operator pattern's five pieces:

| Piece | State | Gap |
| ----- | ----- | --- |
| §3.1 Operator Contract | absent | no clause requiring `saveBuildEvidence` before phase advance; no clause forbidding refusal of a tool that's in the delivered list; no clause requiring a process-issue log when no tool was called |
| §3.2 Skill Playbooks | partial | per-phase guidance exists in [build-agent-prompts.ts](../../../apps/web/lib/integrate/build-agent-prompts.ts) but is not framed as named skills with input/step/tool/output/check |
| §3.3 Tool Surface | adequate | 21 tools delivered; gap is `report_quality_issue` (exists, not contractually required) and the contract that ties tool failure to a logged issue |
| §3.4 Persistent Work Products | schema-ready | `FeatureBuild.{brief, designDoc, buildPlan, taskResults, verificationOut, acceptanceMet}` all exist as JSON columns; nothing enforces "save before advance" |
| §3.5 UI Surface | partial | Build Studio shows phase + brief + workflow graph; missing: pending-vs-saved-work distinction; "process issues" panel; visible signal when a turn produced no work product |

Single-line summary: build-specialist already has the *plumbing* to be an operator, but it is wired as a chat responder.

## 2. Operator Contract — nine clauses

To be added at [prompts/route-persona/build-specialist.prompt.md](../../../prompts/route-persona/build-specialist.prompt.md) by replacing **only** the current `# Tools Available` and `# Operating Rules` sections with a unified `# Operator Contract`. The existing `# Role`, `# Accountable For`, `# Interfaces With`, and `# Out Of Scope` sections are sound and stay. Bump frontmatter `version: 3` → `version: 4` in the same edit.

Two of the nine clauses below (2.8 turn-handoff, 2.9 clarification cap) are lifted directly from the existing prompt's `# Operating Rules` because they are correct and worth preserving as contract-level behavior, not just operating advice.

### 2.1 Domain perspective

Features as code, schemas, components, tests across the five build phases. The current build's `phase` and saved evidence are page state; reference, do not re-derive.

### 2.2 Concrete work product

Phase advances are illegal without the phase-required field saved on `FeatureBuild`:

| Phase | Required field on `FeatureBuild` | Saved by |
| ----- | -------------------------------- | -------- |
| Ideate → Plan | `designDoc` | `saveBuildEvidence({ field: "designDoc", value })` |
| Plan → Build | `buildPlan` | `saveBuildEvidence({ field: "buildPlan", value })` |
| Build → Review | `taskResults` | sub-agent dispatch writes via orchestrator |
| Review → Ship | `verificationOut`, `acceptanceMet` | `saveBuildEvidence` for each |
| Ship → Complete | release-gate decision | `AGT-ORCH-300` (out of build-specialist scope) |

A turn that the user sees as "done with this phase" without the corresponding field saved is a contract violation, not a polite stopping point.

### 2.3 Short confirmations advance

`ok`, `yes`, `proceed`, `next`, `continue`, `go` advance the active phase using the most recent saved evidence. They do not restart research. If `designDoc` was saved last turn and the user says `ok`, the next turn calls `reviewDesignDoc` (or whatever the next step in the phase recipe is), not `start_ideate_research` again.

### 2.4 Save before final response

If the turn produces a designDoc, plan, task result interpretation, verification reading, or acceptance call, `saveBuildEvidence` for the corresponding field is invoked before the closing chat message. The chat message references what was saved, it does not narrate the work as if it were ephemeral.

### 2.5 Approval gate

This clause is narrow on purpose. It does **not** override the existing build-phase auto-execution sequencing.

**What the gate covers — only these four external, main-affecting actions:**

- opening a PR from sandbox → portal repo
- merging a PR
- promoting a build to release-gate decision (handoff to `AGT-ORCH-300`)
- mutating production portal state

**What the gate explicitly does not cover (auto-proceeds, consistent with [prompts/build-phase/build.prompt.md](../../../prompts/build-phase/build.prompt.md) line 113):**

- sandbox file edits, schema migrations, test runs, git diffs inside the sandbox
- `saveBuildEvidence` writes to `FeatureBuild`
- `save_phase_handoff` calls
- `start_ideate_research`, `reviewDesignDoc`, `reviewBuildPlan`, and other internal review tools
- any read-only tool

The build-phase prompt's existing rule — *"Do not pause for routine go-ahead requests during planned build work. Continue unless a blocker, safety concern, or scope-changing decision requires user input."* — remains correct and is not altered by this contract. Internal Build-phase work auto-proceeds. Clause 2.5 only triggers when the build-specialist is specifically attempting one of the four enumerated external actions, which in practice means at Ship phase or when handing off to `AGT-ORCH-300`.

Approval today is UI-driven: build-specialist surfaces the proposed external action in chat, the user clicks the existing approval button on `FeatureBuild` (e.g. "Record Approve Start"), and the platform records the state transition. The build-specialist does not auto-execute external actions and does not bypass the UI gate.

A tool-callable approval-request surface (so the agent can name the proposed external action structurally instead of in prose) is a wave-3 follow-up; not in scope here.

### 2.6 Tool failure / refusal reporting

The agent's contractual obligation is to **report honestly**: never claim a tool is unavailable when it appears in the delivered tool list; never fabricate success; never silently skip a phase-required action.

The platform's enforcement obligation is to **detect and log automatically**:

- The agentic loop already counts `toolCalls=0` per iteration. When that count is zero AND the phase contract required a tool call (per the active skill playbook), the platform writes a `PlatformIssueReport` row tagged with the agent, route, build, and phase before the chat turn is shown to the user.
- When the agent's text response asserts a tool is unavailable AND that tool name appears in the iteration's delivered tool list, the platform writes a `PlatformIssueReport` row with `type=runtime_error`, title prefixed `[coworker-process] tool-refused-despite-availability`, and the offending tool name in the description.

The agent does not need to call `report_quality_issue` itself for these conditions — a hallucinating LLM cannot be relied on to self-report its own hallucination. The platform owns the detection. The agent owns honesty.

For genuine, agent-detected issues that the platform's heuristics won't catch (e.g. a tool returned a confusing error and the agent wants to flag it), the agent uses `report_quality_issue` directly. The existing tool's `type` enum (`runtime_error` / `user_report` / `feedback`) is sufficient for wave 2 with a `[coworker-process]` title prefix; widening the enum to include first-class `coworker_process_issue` is a wave-3 schema follow-up.

### 2.7 No-repeat-diagnosis

If the prior turn's saved evidence covers the user's current message, the agent advances rather than re-running the same diagnostic. "We already saved the design doc; advancing to plan" beats "let me look at the page again."

### 2.8 Always end with a clear next step

Every turn ends with the user knowing exactly what comes next: the phase to move to, the action the agent is about to take, or the input the agent needs from the user. Never finish a turn with the user uncertain. (Lifted from the existing prompt's `# Operating Rules` — promoted to contract status because it is the difference between a coworker that drives a workflow and one that drifts.)

### 2.9 One clarification round maximum

If a clarifying question is needed, ask once, then act on whatever the user answered. If the user has already answered the question, do not re-ask. Repeated clarification feels like stalling and wastes the cheapest, most expensive resource: the user's attention.

## 3. Skill Playbooks

One per phase, named, seeded as `.skill.md` under `skills/build/`:

- `build-ideate.skill.md` — inputs: BI body, page state. Steps: `start_ideate_research` (if no scout) → `saveBuildEvidence(designDoc)` → `reviewDesignDoc` → `save_phase_handoff`. Output: saved `designDoc` + passed review. Check: `designDoc` is non-null on `FeatureBuild`.
- `build-plan.skill.md` — inputs: saved `designDoc`. Steps: decompose into tasks, estimate complexity, `saveBuildEvidence(buildPlan)` → `reviewBuildPlan` → `save_phase_handoff`. Output: saved `buildPlan` + passed plan review. Check: `buildPlan.tasks` non-empty, each task has acceptance criterion; `planReview` non-null with pass verdict.
- `build-execute.skill.md` — inputs: saved `buildPlan`. Steps: dispatch via orchestrator to `AGT-BUILD-{DA,SE,FE}`; consume `taskResults`. Output: `taskResults` with per-task status. Check: every task `DONE` or escalated.
- `build-review.skill.md` — inputs: saved `taskResults`. Steps: dispatch `AGT-BUILD-QA`; interpret typecheck + tests; `saveBuildEvidence(verificationOut, acceptanceMet)` → `save_phase_handoff`. Output: pass/fail verdict. Check: typecheck pass + acceptance criteria met (or explicit user override recorded).
- `build-ship.skill.md` — inputs: saved review evidence. Steps: open PR (approval-gated), surface to user, hand off to `AGT-ORCH-300` for release-gate. Output: release-gate ticket. Check: PR URL recorded on `FeatureBuild`.

Each skill is loadable via the existing skill-discovery substrate; the build-specialist persona declares the five skills in its frontmatter.

## 4. Tool Surface

Currently delivered to `AGT-WS-BUILD`: 21 tools (verified in portal logs `[tools] route=/build agent=build-specialist count=21`). Coverage by operator-pattern category:

- read context: `read_project_file`, `search_project_files`, `list_project_directory`, `query_backlog`, `describe_model`, `search_design_intelligence`, `search_portfolio_context` ✓
- create/update internal work product: `update_feature_brief`, `saveBuildEvidence`, `save_build_notes`, `confirm_taxonomy_placement`, `analyze_reusability`, `propose_decomposition`, `assess_complexity` ✓
- create tasks/follow-ups: `propose_decomposition`, `save_phase_handoff` ✓
- request approval for risky actions: UI-driven via `FeatureBuild` state transitions (existing) ✓ (sufficient for wave 2; tool-callable variant is wave-3)
- record execution evidence: `saveBuildEvidence` ✓
- log operational issues: `report_quality_issue` exists at platform level; ensure it is in the build-specialist's delivered tool set ✗ (gap, small)

One firm gap to close before the contract is enforceable:

1. **Add `report_quality_issue` to build-specialist's tool delivery** so clause 2.6's agent-side reporting path is available. Platform-side detection (also clause 2.6) is implemented in the agentic-loop guard, not as a tool.

Approval-gate tool surface is intentionally deferred — wave 2 relies on the existing UI-driven gate which already works. Adding a tool layer too early would create a parallel path before we know its shape.

## 5. Persistent Work Products

The work-product fields all exist on `FeatureBuild` today; no new tables are needed for them. One additive nullable column on the existing `PlatformIssueReport` model is needed for clause 2.6 attribution; that is in Slice 1.

Schema-ready on `FeatureBuild`:

- `brief` — feature brief (intake; `update_feature_brief`)
- `designDoc` — Ideate output (`saveBuildEvidence`)
- `designReview` — Ideate review verdict (`reviewDesignDoc` writes via platform)
- `buildPlan` — Plan output
- `planReview` — Plan review verdict (`reviewBuildPlan` writes via platform)
- `taskResults` — Build phase output (orchestrator writes)
- `verificationOut` — Review phase verdict
- `acceptanceMet` — Review acceptance call
- `gitCommitHashes` — Ship phase artifact
- `releaseBundleId` — Ship phase artifact (handed to `AGT-ORCH-300`)

For clause 2.6 reporting:

- `PlatformIssueReport` rows tagged with the offending agent (`agentId`) and route (`routeContext='/build'`). Today the model has those fields but no `featureBuildId` foreign key — **Slice 1 adds one as an additive, nullable column.** Slice 2's UI surface depends on it for per-build attribution; Slice 1 writers populate it from day 1 so Slice 2 has no backfill question. This is the only schema change in wave 2.

## 6. UI Surface

Build Studio at [/build](http://192.168.0.200:3000/build) currently shows:

- left panel: build list filtered by `createdById` *(separate gap surfaced by today's test: cross-user builds are hidden — see open follow-up)*
- center: brief + workflow graph + phase indicator
- right: coworker chat panel

Missing per operator-pattern §3.5:

- **Pending-vs-saved-work distinction** — current turn produced a draft (in chat) but nothing saved should look different from a turn that saved evidence. Today they look identical.
- **Process-issues panel** — `QualityIssue` rows for the active build should surface a badge/count and a drill-in. Today they are invisible to the user.
- **No-work-saved warning** — when a phase turn closes without writing the phase-required field, the UI should show a soft warning so the user notices a contract miss.

These changes are scoped to Build Studio center-panel components; no new routes.

## 7. Implementation Slices

Wave 2 lands as three sequential PRs. Each slice has a standalone acceptance and a re-run of the BI-E9CD1B92 lifecycle test as its demo. Slice 2 depends on Slice 1; Slice 3 depends on Slice 1 (and benefits from Slice 2 visibility, but does not require it).

### Slice 1 — Contract Enforcement

The behavioral fix. No UI changes. No new skill files. Smallest shippable change that proves the operator contract repairs the symptom.

1. **Prompt rewrite** — in `build-specialist.prompt.md`, replace **only** `# Tools Available` + `# Operating Rules` with the unified `# Operator Contract` from §2. Preserve `# Role`, `# Accountable For`, `# Interfaces With`, `# Out Of Scope`. Bump frontmatter `version: 3` → `4`. (Skills declaration deferred to Slice 3.)
2. **Tool delivery** — ensure `report_quality_issue` is in the build-specialist's delivered tool set (clause 2.6 agent path).
3. **Platform-side enforcement** — agentic-loop guards for clause 2.6 platform path:
   - zero-tool-call detection on phase-required turns
   - tool-refused-despite-availability detection (agent text asserts unavailability of a tool present in the iteration's delivered tool list)
   Both write `PlatformIssueReport` rows.
4. **Schema migration** — add `featureBuildId` foreign key to `PlatformIssueReport` (additive, nullable, low-risk). Slice 1 writers populate it from day 1 so Slice 2 UI consumes a populated field rather than backfilling.
5. **Save-before-final-response enforcement** — the agentic loop verifies that a turn which produced phase-required output also produced the matching `saveBuildEvidence` call before the closing message reaches the user. Failure writes a `PlatformIssueReport` and surfaces the issue in chat per clause 2.6.
6. **Tests** — one test per contract clause exercising the agent loop:
   - clause 2.2 (phase advance illegal without saved evidence)
   - clause 2.3 (short confirmations advance, do not restart)
   - clause 2.4 (save before final response)
   - clause 2.6 (zero-tool-call detection writes issue; tool-refused-despite-availability writes issue)
   - clause 2.7 (no-repeat-diagnosis when prior evidence covers the message)
   - clause 2.8 (turn ends with a clear next step)
   - clause 2.9 (one clarification round maximum)
   - regression: today's BI-E9CD1B92 failure mode (build-specialist refusing `start_ideate_research` while it is in the delivered list)
7. **Acceptance demo** — re-run BI-E9CD1B92 → FB-2A2C2AC5 lifecycle. Build-specialist must drive Ideate to a saved `designDoc` without operator intervention. The user sees no UI changes yet (Slice 2's job) but the contract behavior is correct: tool calls happen, evidence saves, phase handoffs fire, and any process miss writes a `PlatformIssueReport`.

### Slice 2 — Build Studio Visibility

Make Slice 1's contract enforcement visible to the user. Pure UI + read-side work; no behavioral change.

1. **Process-issues badge/panel** — `PlatformIssueReport` rows where `featureBuildId` matches the active build surface a badge on Build Studio's center panel with a count and a drill-in panel listing each issue (type, agent, route, timestamp, link to the chat turn that triggered it).
2. **Saved-vs-unsaved evidence state** — Build Studio's brief/evidence panel distinguishes saved evidence (read from `FeatureBuild` JSON columns) from in-flight chat drafts. Today they look identical; Slice 2 makes the difference visible.
3. **No-work-saved warning** — when a phase turn closes without writing the phase-required field, a soft warning chip appears next to the phase indicator. Same condition that wrote the `PlatformIssueReport` in Slice 1; this is the user-facing surface for it.
4. **Tests** — UI snapshot/integration tests for the three new affordances. Read-side only; no agent loop coverage needed (already in Slice 1).
5. **Acceptance demo** — re-run BI-E9CD1B92 lifecycle and observe: badges and saved-vs-unsaved state update through Ideate → Plan → Build → Review → Ship. A deliberately-failed turn (e.g. force a phase advance without saving) surfaces a no-work-saved warning.

### Slice 3 — Build Skill Playbooks

Once the contract path is proven, formalize the per-phase recipes as named skills.

1. **Skill files** — author the five `.skill.md` files in `skills/build/` per §3.
2. **Persona declaration** — add `skills:` field to `build-specialist.prompt.md` frontmatter referencing the five skill slugs.
3. **Skill discovery wiring** — verify the existing skill-discovery substrate ([apps/web/lib/actions/skill-discovery.ts](../../../apps/web/lib/actions/skill-discovery.ts)) loads build-route skills correctly; extend if missing.
4. **Tests** — assert each skill loads, declares its inputs/steps/tools/output/check fields, and is selectable for the matching phase.
5. **Acceptance demo** — re-run BI-E9CD1B92 lifecycle with skill-driven phase progression. The agent's reasoning trace should reference the active skill ("running build-ideate skill, step 2 of 4") rather than re-deriving the workflow each turn.

### Out of scope for wave 2 (deferred to wave 3+)

- Sub-agent personas (`AGT-BUILD-DA/SE/FE/QA`) get the same treatment in wave 3 — they share the same prompt-rot bug.
- Reviewer-pass-on-refusal (deliberation framework integration) — second-line defense layered on once contract alone is proven.
- Other 7 affected coworkers (`ops-coordinator`, `hr-specialist`, `admin-assistant`, `ea-architect`, `customer-advisor`, `platform-engineer`, `portfolio-advisor`) — wave 4 sweep using the now-validated pattern.

## 8. Acceptance Criteria

Inherits the operator-pattern §6 acceptance criteria. Build-specific specializations split per slice:

### Slice 1 acceptance

- The build-specialist names the phase-required work product before producing it ("I'm going to draft the designDoc and save it").
- After Ideate, `FeatureBuild.designDoc` is non-null, OR a `PlatformIssueReport` exists explaining why not.
- `ok` from the user advances the phase if the prior turn saved evidence; restarts diagnosis only if no evidence is saved or the user asks.
- A turn that produces zero tool calls when the phase recipe requires one results in a `PlatformIssueReport` row before the chat closes.
- The build-specialist does not assert tool unavailability for any tool name present in its delivered tool list. Such an assertion writes a `PlatformIssueReport` automatically.
- BI-E9CD1B92 → FB-2A2C2AC5 lifecycle completes through Ideate → Plan → Build → Review → Ship and the production portal `/workspace/my-queue` shows the design-token fix, without operator intervention past phase-boundary approvals.

### Slice 2 acceptance

- Build Studio UI surfaces saved evidence (distinct from in-flight chat drafts), process-issue badges/panel, and no-work-saved warnings.
- A user looking only at the Build Studio page (not the chat panel) can tell whether the most recent phase turn produced saved work or not.

### Slice 3 acceptance

- The five `skills/build/*.skill.md` files load via skill-discovery and are referenced from the `build-specialist.prompt.md` frontmatter.
- The agent's reasoning trace identifies the active skill and step rather than re-deriving the workflow each turn.

## 9. Open Follow-Up

- **Cross-user build visibility** — today's test surfaced that Build Studio's `/build` list filters by `createdById`, hiding builds promoted via MCP under a different identity. Separate bug; file a BI.
- **Reviewer-pass on refusal** (deliberation framework integration) — once wave 2 ships, evaluate whether contract + platform-side enforcement alone fix the symptom or whether a reviewer pre-check on refusal/blocker outputs is needed. Pattern definitions and runtime substrate already exist per [2026-04-21 deliberation framework spec](2026-04-21-deliberation-pattern-framework-design.md).
- **Lint check for prompt state-leakage** — small CI check on `prompts/**/*.prompt.md` for two failure modes:
  - Forbidden phrases: `currently \[\]`, `pending follow-on assignment`, `once granted`, `once the per-agent grant`, `will hold a curated set`.
  - "Tools Available" sections that enumerate grants without citing the `tool_grants` source path (`packages/db/data/agent_registry.json`) — the marketing-specialist shape is the reference.

  Add in the wave-2 PR or as a small standalone PR.
- **AGENTS.md citation** — once the operator pattern wave 1 ships, add a short pointer in AGENTS.md to the canonical pattern spec so future coworker work cites it from the start.
- **Widen `report_quality_issue` enum** — add `coworker_process_issue` as a first-class `type` value with optional `featureBuildId`, `phase`, and `category` fields; deprecate the `[coworker-process]` title-prefix convention used as the wave-2 stopgap. Wave-3 schema follow-up.
- **Tool-callable approval surface** — formalize the FeatureBuild approval gates as a tool the agent can invoke (`request_external_action_approval`) so the contract's clause 2.5 has a structural surface, not just prose. Wave-3.
