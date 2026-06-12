---
title: Build Studio Owner Improvement Experience
status: draft
date: 2026-06-12
owner: platform
specKind: design
relatedSpecs:
  - docs/superpowers/specs/2026-05-20-build-studio-layout-redesign-design.md
  - docs/superpowers/specs/2026-05-30-build-studio-right-sizing-design.md
  - docs/superpowers/specs/2026-06-05-human-experience-closed-loop-design.md
  - docs/architecture/2026-06-09-dap-experience-layer-design.md
  - docs/architecture/2026-06-09-long-running-agentic-process-architecture.md
relatedPrinciples:
  - docs/founder-kernel/wiki/principles/architecture-over-shortcuts.md
  - docs/founder-kernel/wiki/principles/governance-approves-evidence-not-provenance.md
  - docs/founder-kernel/wiki/principles/never-ask-user-to-run-commands.md
  - docs/founder-kernel/wiki/principles/no-hardcoded-colors.md
  - docs/founder-kernel/wiki/principles/compose-report-kit-for-reporting-ux.md
---

# Build Studio Owner Improvement Experience

## 1. Thesis

Build Studio should feel to a small business owner like a business-improvement partner, not a developer tool. The owner-facing object is an **Improvement**: a governed change intended to improve a real business workflow. Build Studio remains the backstage engine that safely turns an Improvement into software.

The owner should be able to say, "Make quotes easier to send," "Fix this booking form," or "Add customer follow-up reminders." The platform should shape the request, ask only the minimum business questions, build safely in the background, then bring the owner back only when judgment is required.

The core design is:

```text
Ask for outcome -> shape the work -> approve plan -> build safely -> review evidence -> approve release -> follow up on outcome
```

This adopts the interaction grammar popularized by Lovable-style tools: natural-language intent, a separate planning mode, a building mode, and a visual preview loop. DPF must add what those tools generally do not guarantee: durable evidence, HITL gates, work coordination, verification, rollback, and plain-language accountability.

## 2. Current-State Constraints

This design is intentionally a projection over existing Build Studio substrate, not a parallel development path.

Current DPF substrate already includes:

| Concern | Existing substrate | Design rule |
| --- | --- | --- |
| Lifecycle | `FeatureBuild.phase`: `ideate`, `plan`, `build`, `review`, `ship` | Preserve the engine lifecycle. Project it into owner language. |
| Evidence | `designDoc`, `designReview`, `buildPlan`, `planReview`, `taskResults`, `verificationOut`, `acceptanceMet`, `uxTestResults`, `uxVerificationStatus` | Do not invent a second evidence ledger. |
| Phase handoff | `PhaseHandoff` | Use it to power owner re-entry digests and evidence review. |
| Work coordination | `WorkCapsule`, runtime leases, MCP evidence tools | Keep backstage. Show only status and outcomes to owners. |
| Right-sizing | `(work type, size) -> LifecyclePolicy` in `build-process-matrix.ts` | Owner experience should adapt by work size without making the owner choose ceremony. |
| Durable execution | Inngest migration plan and DAP experience layer | Long-running work must be ambient, resumable, and interrupt-by-exception. |
| Existing UI | Live `BuildStudio` plus demo-data `BuildStudioV2` | Refactor/converge. Do not let the demo shell become a competing UI stack. |

Portal, MCP, and live UX were unavailable during this design session because the portal was being reinstalled/tested. This spec is therefore grounded in repo inspection and prior accepted design docs, not live runtime verification.

## 3. Owner Mental Model

Rename the owner-facing concept:

| Engine term | Owner-facing term |
| --- | --- |
| Build Studio | Improvements, or Improvement Studio where a named route is needed |
| FeatureBuild | Improvement |
| Ideate | Shaping |
| Plan | Planned |
| Build | Building |
| Review | Checking |
| Ship | Ready / Go Live |
| Complete | Live |
| Failed | Needs Attention |
| HITL gate | Needs You |
| Evidence | Proof |
| Sandbox | Preview |

The owner can still click into developer detail when allowed, but the default surface should never require build IDs, branches, MCP tools, containers, schema names, or raw logs.

## 4. Product Surfaces

### 4.1 Improvements Home

The default owner entry point for making the business better.

Primary jobs:

- Start an Improvement from a business outcome.
- See active work.
- See what needs the owner's decision.
- Reopen completed work.
- Understand whether anything is stuck.

Layout:

```text
Header: "What do you want to improve?"
Outcome composer
Needs You inbox strip
Active Improvements
Recently Live
```

The composer should provide archetype-aware examples. A rental business should see examples such as "make it easier to quote rentals," not generic software prompts.

### 4.2 Needs You Inbox

The highest-priority surface. It is the owner-friendly HITL queue.

An inbox item is created only when a decision is actually required:

- approve a plan
- answer a business question
- choose between two safe options
- review evidence
- approve release
- send work back
- pause or abandon work

Fixed owner actions:

| Action | Meaning |
| --- | --- |
| Approve | Continue with the proposed action. |
| Edit | Change the plan or instruction before continuing. |
| Answer | Provide missing business information. |
| Send back | The result is not acceptable; revise with the attached reason. |
| Defer | Keep paused without losing context. |
| Escalate | Route to an admin/developer/operator review path. |

No "FYI" items belong in this queue. Status updates stay ambient.

### 4.3 Improvement Workspace

One Improvement at a time. Conversation remains available, but the main panel changes by phase.

| Owner phase | Primary artifact |
| --- | --- |
| Shaping | Business brief and open questions |
| Planned | Editable plan checklist |
| Building | Ambient progress and preview |
| Checking | Evidence packet |
| Ready | Release decision |
| Live | Outcome follow-up |

The workspace has three zones:

```text
Left: Improvement list / related active work
Center: current artifact, preview, or evidence packet
Right: coworker conversation and contextual actions
```

This preserves the Build Studio layout-redesign principle that the working artifact is the center of gravity, while avoiding a developer-only graph as the first thing an owner sees.

### 4.4 Developer Details

Developer details are collapsible and permission-aware. They include:

- build ID
- branch/workspace info
- raw phase graph
- runtime lease
- sandbox/container info
- tool calls
- raw test output
- raw evidence JSON
- logs

This is an admin/operator drill-down, not the default owner experience.

## 5. End-to-End Workflow

### 5.1 Start: Business Outcome Intake

The owner enters an outcome:

```text
"I want customers to book pickup times without calling us."
```

The system converts this into a draft Improvement brief:

- business outcome
- affected workflow
- affected people
- source evidence
- constraints
- success signals
- likely risk level
- whether this is a feature, fix, chore, or doc-style change

The coworker asks at most one question at a time, only when the answer changes the plan or safety gate.

### 5.2 Shape: Smart Clarification

Clarification should feel like business consulting, not requirements gathering.

Good question:

```text
Should customers be able to choose any available pickup time, or only time windows you define?
```

Bad question:

```text
What schema model should hold pickup window availability?
```

The output is a short owner-readable brief plus hidden technical interpretation.

### 5.3 Plan: Editable Intent Preview

The plan is shown before execution and is editable.

Owner-facing plan format:

```text
This Improvement will:
1. Add pickup-time choices to the booking flow.
2. Let staff define available pickup windows.
3. Send the selected time into the confirmation record.
4. Check the booking path on desktop and mobile.
```

Every plan item maps to backstage evidence:

- design evidence
- implementation task
- verification requirement
- acceptance criterion
- optional UX check

Approving the plan records the HITL decision and advances the lifecycle.

### 5.4 Build: Ambient Safe Execution

During build, the owner sees:

- current phase in owner language
- last meaningful action
- whether the process is alive
- whether it is waiting on the owner
- expected next decision

No fake percentages. Use milestone-based progress:

```text
Building safely: checking the booking flow changes.
Last action: created the pickup-time selector.
Next: test the booking path.
```

The owner can pause, open preview, or ask what is happening. They should not need to babysit logs.

### 5.5 Preview: Point, Comment, Correct

Adopt a Lovable-style preview toolbar, but bind it to DPF evidence.

Preview actions:

| Action | Behavior |
| --- | --- |
| Select | Captures element, route, viewport, and component hint. |
| Comment | Adds an owner-visible requested change. |
| Edit copy | Creates a scoped copy-change request. |
| Mark issue | Creates a review concern tied to visual evidence. |
| Accept visual state | Marks one acceptance criterion as visually satisfied when eligible. |

The preview toolbar never directly bypasses phase gates. A visual request becomes structured input to the current Improvement, then the engine records how it was handled.

### 5.6 Check: Evidence Packet

The review surface is not a diff. It is proof.

Evidence packet sections:

| Section | Owner question answered |
| --- | --- |
| What changed | What will I notice in the business? |
| Why it matches the request | Did it solve the thing I asked for? |
| How we checked it | What tests, typecheck, UX checks, and acceptance criteria ran? |
| What needs judgment | What does the system need me to decide? |
| What could go wrong | What risks remain? |
| How to undo | What rollback or recovery path exists? |

Technical detail sits behind expansion. Screenshots can support evidence, but dynamic verification and recorded acceptance are the proof.

### 5.7 Go Live

Release approval should show consequences:

- who will be affected
- what will change in the live portal
- whether data/schema changes are involved
- whether a backup/rollback point exists
- whether there are unresolved risks
- what happens immediately after approval

The owner action is simple:

```text
Go live
Send back
Schedule later
Escalate
```

The governed promotion path remains backstage and evidence-gated.

### 5.8 Follow Up

After the Improvement is live, the system should ask whether the business outcome improved.

Examples:

- Did customers use pickup times?
- Did staff stop receiving calls about booking times?
- Did quote completion time improve?
- Did support complaints drop?

This closes the continuous-improvement loop and feeds future Improvement suggestions.

## 6. HITL And Attention Policy

HITL must be precise. The system should interrupt only when a decision is blocking or materially consequential.

| Event | Surface | Push? |
| --- | --- | --- |
| Plan ready for approval | Needs You | Yes |
| Question required to continue | Needs You | Yes |
| Build started | Ambient status | No |
| Step complete | Timeline only | No |
| Verification failed and blocks review | Needs You | Yes |
| UX check produced advisory concern | Evidence packet | No, unless release is blocked |
| Release ready | Needs You | Yes |
| Build completed while owner away | Digest + Needs You if release decision remains | Maybe |
| Idle/no work left | Home status | No |

The owner promise is: "We only interrupt when your decision matters."

This preserves calibrated trust and avoids notification fatigue.

## 7. Evidence And Data Contract

### 7.1 No New Evidence Ledger In Phase 1

Phase 1 should reuse existing models:

- `FeatureBuild` evidence fields
- `PhaseHandoff`
- `BuildActivity`
- `WorkCapsuleActivity`
- `ToolExecutionReceipt`
- `RuntimeVerification`

Add a projection adapter rather than a new table:

```ts
type OwnerImprovementView = {
  improvementId: string;
  title: string;
  ownerPhase: "shaping" | "planned" | "building" | "checking" | "ready" | "live" | "needs_attention";
  needsYou: OwnerDecisionItem[];
  summary: string;
  evidencePacket: OwnerEvidencePacket | null;
  preview: OwnerPreviewState | null;
  developerDetailsHref: string | null;
};
```

### 7.2 New Data Only When It Proves Necessary

Potential later models:

| Model | When needed |
| --- | --- |
| `BuildPreviewAnnotation` | If visual comments must survive across preview rebuilds with anchors. |
| `HitlDecisionItem` | If Needs You must span more process kinds than Build Studio and cannot be projected from existing records. |
| `OwnerEvidencePacket` | If evidence packets need immutable snapshots for audit beyond existing evidence fields. |

Do not start with these migrations. Start with adapters and projections over the canonical evidence substrate.

## 8. Navigation And Information Architecture

Global navigation should not expose every technical Build Studio concept.

Recommended IA:

| Surface | Route | Audience |
| --- | --- | --- |
| Improvements | `/build` or future `/improvements` | Owner/operator |
| Improvement detail | `/build?buildId=...` initially; future `/improvements/:id` | Owner/operator |
| Needs You | Home strip plus cross-process inbox when DAP generalizes | Owner/operator |
| Build Studio config | `/platform/ai/build-studio` | Admin |
| Developer diagnostics | detail drawer or `/platform/ai/build-studio/...` drill-down | Admin/developer |

Do not mix configuration with owner work. The owner asks for improvements; admins configure engines.

## 9. UI Standards

Implementation must follow DPF UI rules:

- no hardcoded colors
- use `var(--dpf-*)` tokens
- use report-kit primitives for status/data/evidence displays
- progressive disclosure for technical details
- no raw tool names in owner text
- mobile owner view must still expose Needs You, active work, and evidence review
- preview toolbar controls use icons plus accessible labels/tooltips
- cards are for individual repeated items, not nested page structure

The design must stay operational and dense. This is a business work surface, not a marketing landing page.

## 10. Refactoring Requirement

At least 20% of implementation capacity for this work is reserved for refactoring.

Required refactor targets:

1. **Converge `BuildStudio` and `BuildStudioV2`.** `BuildStudioV2` contains useful interaction ideas but is demo-data driven. It must not become a parallel product path.
2. **Extract owner projection helpers.** Owner phase, Needs You items, evidence packet summaries, and preview state should be pure helpers with tests.
3. **Preserve existing evidence/gate authority.** Do not duplicate `checkPhaseGate` logic in components.
4. **Delete obsolete UI once replaced.** Avoid accumulating tabs, panels, and cards that describe the same state at different altitudes.
5. **Separate owner copy from developer copy.** Owner-facing wording should live in a single copy helper or route-copy module, not scattered inline.

The target is a simpler surface over a stronger engine, not an additional shell around the current complexity.

## 11. Research And Benchmarking

### Open-source / open-core patterns

| Source | Data model pattern | Adopt | Reject |
| --- | --- | --- | --- |
| LangChain Agent Inbox / LangGraph HITL | Interrupts pause agent execution, present pending action, resume after human response. Inbox actions map to accept/edit/respond/ignore. | Needs You inbox as a queue of durable decision items. | Raw agent interrupt payloads in owner UI. |
| n8n executions | Workflow executions preserve status, timing, node names, and optional execution metadata; sensitive data can be redacted. | Evidence packet should preserve metadata while hiding raw payloads by default. | Treating execution logs as the primary owner review artifact. |
| GitLab CI/CD pipelines | Pipelines are composed of jobs and downstream graphs; mini graphs show status while detail pages expose logs. | Owner home shows compact phase/status; detail drawer exposes deeper execution evidence. | Developer pipeline vocabulary as owner-facing language. |

### Commercial patterns

| Source | Product pattern | Adopt | Reject |
| --- | --- | --- | --- |
| Lovable | Plan mode for decision-making, Build mode for execution, visual preview toolbar, version history, publish flow. | Think/build separation, point-and-comment preview loop, fast visual correction. | One-click publish without DPF evidence gates and rollback discipline. |
| Linear Agent Interaction | Agent sessions have states such as pending, active, awaiting-input, error, complete, stale; agent acts as delegate, not assignee. | Consistent owner statuses and human accountability. | Making the agent the owner of business judgment. |
| Cursor Plan Mode / Cloud Agents | Plan is editable before execution; cloud agents run asynchronously and return evidence. | Editable plan and re-entry digest. | Diff-first review for non-technical owners. |

### Standards

This design follows:

- Microsoft HAX principles: make uncertainty, capability limits, rationale, and action consequences visible.
- Progressive disclosure: default owner view shows the decision and proof; technical artifacts are drill-down.
- DPF kernel principle: governance approves evidence, not provenance.

References:

- Lovable docs: https://docs.lovable.dev/introduction/getting-started, https://docs.lovable.dev/features/plan-mode, https://docs.lovable.dev/features/preview-toolbar, https://docs.lovable.dev/features/security-view
- LangChain HITL docs: https://docs.langchain.com/oss/python/langchain/frontend/human-in-the-loop
- LangChain Agent Inbox: https://github.com/langchain-ai/agent-inbox
- Linear Agent Interaction: https://linear.app/developers/agent-interaction
- n8n executions: https://docs.n8n.io/workflows/executions/
- GitLab pipelines: https://docs.gitlab.com/ci/pipelines/
- Microsoft HAX: https://www.microsoft.com/en-us/research/blog/guidelines-for-human-ai-interaction-design/

## 12. Implementation Slices

### Slice 1: Owner Projection Layer

Goal: derive owner-facing Improvement views from current `FeatureBuild` rows.

Deliverables:

- `deriveOwnerImprovementView()`
- owner phase mapping
- Needs You projection from workflow action/gate state
- evidence packet summary projection
- tests for each lifecycle phase and key blocked states

No schema migration.

### Slice 2: Improvements Home

Goal: owner-facing landing surface for active and completed Improvements.

Deliverables:

- outcome composer
- Needs You strip
- active improvements list
- recently live list
- admin/developer details hidden by permission

This can initially keep `/build`.

### Slice 3: Improvement Workspace

Goal: one Improvement detail surface with phase-specific artifacts.

Deliverables:

- owner phase header
- editable plan view
- ambient build status
- evidence packet view
- developer detail drawer
- coworker context actions

### Slice 4: Preview Annotation Loop

Goal: Lovable-style visual corrections without bypassing evidence gates.

Deliverables:

- preview toolbar
- select/comment/copy-edit actions
- structured preview annotation projection
- rerun/review integration
- accessibility and mobile behavior

Defer schema unless anchors must persist across preview rebuilds.

### Slice 5: HITL Inbox Generalization

Goal: make Needs You the cross-process decision surface.

Deliverables:

- durable owner decision item projection
- fixed verbs
- notification policy
- re-entry digest
- metrics for notification precision and decision dwell

This should compose with the DAP experience layer rather than staying Build-Studio-only.

## 13. Acceptance Criteria

The design is implemented when:

- A small business owner can start an Improvement without seeing developer terminology.
- Every owner-visible phase maps to the canonical Build Studio lifecycle.
- A plan approval records a durable HITL decision.
- The owner can review a feature by evidence, not by raw diff/log.
- Technical detail is available to permitted admins but hidden by default.
- Visual preview feedback becomes structured input and does not bypass gates.
- No new evidence ledger exists in Phase 1.
- `BuildStudioV2` is converged into the live Build Studio path or deleted.
- UI uses DPF theme tokens and report-kit where applicable.
- Runtime-bound verification evidence still names its substrate per AGENTS.md.

## 14. Open Questions

1. Should the owner-facing route stay `/build` for now, or should DPF introduce `/improvements` with `/build` as an admin/developer alias?
2. Should "Improvements" be the permanent product word, or should archetypes override it with terms such as "Business changes" or "Upgrades"?
3. Should the preview annotation model start as a `WorkCapsuleActivity` payload, or should it get a dedicated table once the toolbar lands?
4. Should owner release approval be modal, inbox-item based, or both depending on risk class?
5. Should `uxVerificationStatus="failed"` remain advisory in owner copy, or should owner-facing release copy treat failed UX checks as "needs review" even when the gate technically allows ship?

## 15. Non-Goals

- Replacing Build Studio's engine.
- Replacing MCP coordination.
- Replacing `FeatureBuild` evidence fields.
- Adding a no-code WYSIWYG editor.
- Making direct production changes from preview annotations.
- Exposing raw tool execution to owners.
- Solving all DAP process kinds in the first slice.

## 16. Next Step

Review this spec for the owner mental model and route language first. If approved, create a focused implementation plan for Slice 1 only: the owner projection layer and tests. That slice is the architectural foundation for the later UI work and keeps the refactor bounded.
