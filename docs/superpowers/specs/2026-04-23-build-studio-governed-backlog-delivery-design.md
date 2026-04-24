# Build Studio Governed Backlog Delivery Design

| Field | Value |
|---|---|
| Date | 2026-04-23 |
| Status | Draft |
| Author | Codex + Mark Bodman |
| Depends On | `2026-04-21-backlog-triage-build-studio-design.md`, `2026-04-20-ship-phase-fork-redesign-design.md`, `2026-04-23-public-contribution-mode-design.md` |
| Scope | Backlog intake, Build Studio effort creation, sandbox-first review, contribution, promotion, and scheduled tee-up |

## 1. Problem Statement

Build Studio currently has good pieces, but they do not yet form one trustworthy enterprise delivery loop for non-developers.

Current pain points:

1. The backlog and Build Studio are still adjacent systems instead of one governed workflow.
2. The Build Studio UX shows progress, but it does not yet make the backlog item the obvious canonical origin of the work.
3. Contribution and self-promotion are implemented as ship-phase tool steps, but the user-facing model is still too developer-shaped and insufficiently approval-centric.
4. The platform has a sandbox capability, but that capability is not yet positioned as the primary business-facing trust gate before production.
5. The repo contains evidence of spec/code drift in backlog triage and promotion:
   - `triage_backlog_item`, `size_backlog_item`, and `promote_to_build_studio` are declared in `apps/web/lib/mcp-tools.ts`
   - enum parity tests exist in `apps/web/lib/backlog-enums.test.ts`
   - the current `BacklogItem` and `FeatureBuild` schema does not yet show the intended runtime linkage or triage fields from the revised design
   - the `mcp-tools.ts` execution switch currently exposes backlog CRUD paths but does not implement execution cases for the newer triage/promotion tools
6. The main Build Studio experience still assumes the user can mentally bridge backlog item, feature effort, sandbox preview, contribution, and release.

The target user is broader than software engineers. Many users will be operators, managers, analysts, and domain experts who need enterprise-grade outcomes without being forced to think in branches, diffs, migrations, or deployment internals.

The design goal is therefore:

**vibe coding for enterprise-class outcomes**

That means the AI coworker takes responsibility for rigor, standards, and implementation discipline, while the user sees a simple, inspectable, approval-based workflow.

## 2. Live State Snapshot

This design is grounded in the live runtime on **April 23, 2026**, not seed defaults.

Live PostgreSQL queries run against the running `dpf-postgres-1` container returned:

- `Epic`: 3 rows total
- open epics:
  - `EP-LAB-6A91C2` — Integration Lab Sandbox & Private Connectivity Foundation
  - `EP-INT-2E7C1A` — Integration Harness: Benchmarking and Private Deployment Foundation
- done epic:
  - `EP-BUILD-9F749C` — Code Graph Ship Test — Ship Tracking
- `BacklogItem` counts:
  - `open`: 12
  - `in-progress`: 3
  - `done`: 4
- recent active work:
  - only one recent `FeatureBuild` row was present
  - `FB-CG0421T1` remained in `phase = "ship"`

Design consequence:

1. The platform is not yet mature enough for aggressive autonomous build-start or release decisions.
2. Semi-automatic preparation with explicit human approvals is the correct operating mode.
3. The backlog/build/release loop must be made much more explicit so users can trust what the system is doing.

## 3. User Direction Captured In This Design

The approved direction for this spec is:

1. **Semi-automatic backlog automation**
   - AI may triage and prepare draft Build Studio efforts
   - humans remain in the loop for approval before actual execution and release
2. **Eligibility policy**
   - daily tee-up considers `open` backlog items with `triageOutcome = build`
   - allow `small`, `medium`, and `large`
   - bootstrap path is allowed when no open epic exists
3. **Trust-over-time model**
   - the system should widen autonomy only after the process and coworker prove trustworthy
   - until then, the platform stays on the side of caution
4. **Sandbox-first enterprise review**
   - users must be able to see how a change works in a sandbox before committing to production
5. **Layered detail**
   - do not expose developer-only framing by default
   - do expose inspectable detail for knowledge workers who want to understand data types, business rules, and implementation impact

## 4. Goals

1. Make the backlog the canonical business record for feature work.
2. Make Build Studio the governed execution workspace created from backlog items.
3. Introduce a non-technical primary UX with business-readable lifecycle language.
4. Preserve deeper technical and analytical detail through selectable drill-down.
5. Make sandbox preview the main trust gate before production promotion.
6. Separate preparation from irreversible action:
   - prepare is automatable
   - start, contribute, and promote are approval-gated
7. Add a safe daily scheduler that tees up eligible work without silently starting it.

## 5. Non-Goals

1. Full autonomous end-to-end build execution without approvals.
2. Automatic production deployment from backlog intake.
3. Exposing git, PR, migration, or deployment internals as the primary non-developer UX.
4. Replacing the existing Build Studio phase engine in one step.
5. Solving all work-queue automation in this spec.

## 6. Research & Benchmarking

### 6.1 Systems Reviewed

Official references reviewed during design:

- Linear triage and workflow docs
- Cursor Background Agents and Cursor + Linear integration docs
- GitHub issue/PR linking and AI issue triage docs
- Hugging Face repositories, pull requests, and discussions docs
- OpenProject workflow docs

### 6.2 Patterns Adopted

1. **Canonical work item first**
   - GitHub and Linear keep the issue/work item as the durable anchor
   - DPF should keep the backlog item as the business source of truth
2. **AI as execution assistant, not source of authority**
   - Cursor uses the issue tracker as the source item and creates code work around it
   - DPF should do the same with Build Studio efforts
3. **Triage before execution**
   - Linear and OpenProject both treat triage as a distinct control point
4. **Draft artifact before irreversible decision**
   - Hugging Face and GitHub both normalize draft PR/review stages
   - DPF should normalize draft feature efforts and draft contribution/release packages
5. **Human-visible approval gates**
   - strongest systems show clear transition points rather than silent state changes

### 6.3 Patterns Rejected

1. AI owning the backlog lifecycle end-to-end without explicit human checkpoints
2. Directly treating ship as one binary step
3. Forcing non-developers to reason in engineering vocabulary on the main surface

### 6.4 Strategic Differentiator

Most current vibe-coding tools stop at code, branch, or PR generation.

DPF should differentiate by making **sandbox-first enterprise validation** the centerpiece:

`request -> prepared draft -> sandbox preview -> governed release`

That is the missing trust layer for enterprise users.

## 7. Core Design Principles

### 7.1 Backlog Is Canonical

The backlog item is the authoritative business request, priority anchor, and audit object.

The Build Studio effort is the execution record created from the backlog item.

### 7.2 Build Studio Owns Responsibility, Not Authority

The AI coworker should take responsibility for:

- clarifying scope
- creating structured drafts
- sizing and decomposition support
- preparing implementation artifacts
- checking enterprise standards
- preparing release evidence

But authority stays with humans at the important boundaries.

### 7.3 Progressive Disclosure

The default UX must be understandable by a non-developer.

Deeper detail is revealed on demand, including:

- data types
- entities
- business rules
- affected records
- integration points
- technical artifacts

### 7.4 Sandbox Before Production

The key approval question is:

**“Does this behave correctly in preview?”**

not:

**“Do you approve this branch/container/diff?”**

### 7.5 Trust Over Time

Autonomy expands only when the system has earned it with evidence.

V1 therefore optimizes for:

- safe preparation
- visible assumptions
- controlled approvals
- inspectable evidence

## 8. Governed Lifecycle

### 8.1 User-Facing Lifecycle

The primary lifecycle shown to users should be:

1. `Captured`
2. `Triaging`
3. `Prepared Draft`
4. `Ready to Start`
5. `In Progress`
6. `Ready to Release`
7. `Done`

These labels are intentionally business-readable.

### 8.2 Internal Mapping

Under the hood:

- `Captured` maps to newly created backlog items
- `Triaging` maps to intake analysis and human disposition
- `Prepared Draft` maps to a linked draft `FeatureBuild`
- `Ready to Start` maps to approved draft waiting for execution start
- `In Progress` maps to Build Studio ideate/plan/build/review
- `Ready to Release` maps to completed sandbox-validated work waiting on contribution and/or promotion decisions
- `Done` maps to closed workflow states after release disposition

### 8.3 Build Lifecycle Nested Under The Business Lifecycle

For build work, a second nested execution track remains visible:

- `Ideate`
- `Plan`
- `Build`
- `Review`
- `Ready to Ship`

The main lifecycle explains the business state.
The nested lifecycle explains where Build Studio is doing its work.

## 9. Visual Workflow Model

### 9.1 Rename The Current “Graph” Surface

The current tab label should not say `Graph`.

Recommended replacement:

- `Workflow`

This is the clearest, most non-technical default.

### 9.2 Selectable Workflow Nodes

Every node in the workflow should be selectable.

Selecting a node opens a detail surface showing:

- current status
- what happened in that stage
- what the AI did
- what a human did
- assumptions made
- artifacts created
- evidence used
- related objects
- approval outcome or next required action

### 9.3 Selectable Relationships

The links between major objects should also be explorable:

- backlog item -> draft feature effort
- feature effort -> sandbox preview
- feature effort -> contribution artifact / PR
- feature effort -> promotion / release record

This turns the workflow view into both:

1. a progress map
2. a navigable audit trail

## 10. Backlog To Build Studio Integration

### 10.1 Canonical Relationship

Each build-capable backlog item may have one active draft or active Build Studio effort at a time.

Relationship semantics:

- backlog item = canonical business work record
- Build Studio effort = delivery workspace
- statuses sync through controlled transitions, not loose side effects

### 10.2 Semi-Automatic Daily Tee-Up

V1 scheduler policy:

- manual trigger available any time
- one daily background sweep

The daily sweep:

1. scans backlog items
2. selects items eligible for build tee-up:
   - `status = open`
   - `triageOutcome = build`
   - `effortSize in {small, medium, large}`
3. prefers epic-linked items
4. allows bootstrap when no open epic exists
5. creates a **draft** Build Studio effort
6. never auto-starts execution

### 10.3 Draft Build Effort Contents

The generated draft should include:

- linked backlog item
- proposed title
- constrained goal
- suggested portfolio/taxonomy context
- size and confidence
- assumptions requiring confirmation
- related evidence/artifacts
- reason the scheduler selected it

### 10.4 Human Approval Gate

The human action is:

`Approve Start`

That means:

- the request is specific enough
- the assumptions look acceptable
- the draft effort is the correct interpretation

Only after that should Build Studio start ideate/plan/build.

## 11. Sandbox-First Review

### 11.1 Preview As Primary Trust Gate

Every prepared build effort should lead toward a previewable sandbox outcome.

The review UX should emphasize:

- `Preview`
- `What changed`
- `What to test`
- `Known assumptions`
- `Approval needed`

### 11.2 Review Standard

Promotion to production should be blocked until:

1. sandbox preview exists
2. required checks pass
3. acceptance criteria are reviewed
4. a human approves the previewed behavior

### 11.3 Enterprise Outcome

This is the platform’s key differentiator relative to current vibe-coding tools:

- not just “code generated”
- not just “PR opened”
- but “behavior reviewed safely before release”

## 12. Layered Detail Model

### 12.1 Default Surface

The default view should show:

- current workflow stage
- next action
- assumptions
- risks
- preview link
- approval history

### 12.2 Knowledge Worker Detail

Expandable sections should expose:

- data model and data types
- inputs and outputs
- business rules
- affected entities and records
- integrations
- evidence and rationale

This supports analysts, operators, and domain experts who are not developers but still need serious implementation visibility.

### 12.3 Developer / Operator Detail

Further drill-down may expose:

- code diffs
- test output
- PR links
- migration details
- deployment details

These remain available, but not front-and-center for everyone.

## 13. Contribution, Promotion, And Scheduling

### 13.1 Contribution

Contribution is a separate governed decision.

AI may:

- assess reusability
- identify sensitive content
- prepare contribution artifacts
- draft the upstream path

Human approves:

- `Keep private`
- `Share with community`

### 13.2 Promotion

Promotion is a separate release decision.

AI may:

- assess release readiness
- check windows
- package release evidence
- prepare scheduling recommendations

Human approves:

- release now
- schedule for next window
- hold for changes

### 13.3 Scheduling

V1 scheduling scope:

1. on-demand backlog processing
2. one daily backlog tee-up sweep
3. optional scheduling for already-approved promotions

Not included in v1:

- autonomous scheduling of build starts
- hidden background progression of release without approvals

## 14. Data Model Stewardship

### 14.1 Current Mismatch

The current live schema still shows:

- `BacklogItem` without the intended triage fields from the revised backlog design
- `FeatureBuild` without a durable originating backlog linkage
- Build Studio happy-path linkage currently carried largely through JSON state in `FeatureBuild.plan.happyPathState`

This is not sufficient for the governed operating model.

### 14.2 Canonical Runtime Additions

The backlog/build integration should be formalized in schema, not only UI state.

Recommended direction:

#### `BacklogItem`

Add:

- `triageOutcome`
- `effortSize`
- `proposedOutcome`
- `activeBuildId`
- `duplicateOfId`
- `resolution`
- `abandonReason`
- `stalenessDetectedAt`

#### `FeatureBuild`

Add:

- `originatingBacklogItemId`
- optional lifecycle metadata for draft/prepared states if not represented elsewhere

### 14.3 Why

This gives:

- a durable origin link
- one active execution effort per backlog item
- retained historical build attempts
- cleaner UI joins
- real automation eligibility rules

## 15. UX Requirements

### 15.1 Main Surface Language

Use business-friendly labels such as:

- `Workflow`
- `Prepared Draft`
- `Ready to Start`
- `Community Sharing`
- `Release Readiness`
- `Deployment Timing`

Avoid leading with:

- graph
- branch
- diff
- promotion_id
- PR jargon

### 15.2 Main Actions

Backlog items should expose simple actions:

- `Prepare Draft`
- `View Linked Effort`
- `Approve Start`
- `Return to Triage`

Build efforts should expose:

- `Open Preview`
- `Review Assumptions`
- `Inspect Data Model`
- `Approve for Release`

## 16. Implementation Approach

### Phase 1 — Fix Contract Drift

1. Implement `triage_backlog_item`, `size_backlog_item`, and `promote_to_build_studio` in the runtime switch
2. add schema support for backlog/build linkage
3. bring tool contract, schema, and UI state back into alignment

### Phase 2 — Draft Effort Lifecycle

1. introduce explicit draft/prepared workflow handling
2. show backlog-origin linkage in Build Studio
3. add start approval gate

### Phase 3 — Workflow UX

1. rename `Graph` to `Workflow`
2. make nodes selectable
3. add related artifact and evidence drawers

### Phase 4 — Sandbox-First Review UX

1. elevate preview as the primary review entry point
2. reframe release around business-readable checks and approvals

### Phase 5 — Daily Tee-Up Scheduler

1. add on-demand backlog processing action
2. add one daily scheduled tee-up sweep
3. create draft efforts only, never auto-start

### Phase 6 — Contribution And Promotion UX

1. split community sharing and release readiness clearly
2. preserve explicit human approvals

## 17. Open Questions

1. Should `Prepared Draft` be represented as a new persisted backlog/build status or derived from linked-record state?
2. Should the daily tee-up worker create one draft per eligible item or cap daily creation volume to avoid overwhelming reviewers?
3. Should knowledge-worker detail panels include record-level example data by default, or only schema/entity descriptions until expanded?

## 18. Recommendation

Adopt a **governed, sandbox-first, draft-only automation model**:

- backlog is canonical
- AI prepares work
- Build Studio executes within visible lifecycle stages
- sandbox preview is the primary trust gate
- contribution and promotion are explicit approval decisions
- autonomy expands later, only after the platform earns it

This is the right fit for the platform’s current maturity and the stated product direction:

**enterprise-grade outcomes without making non-developers operate like software engineers**
