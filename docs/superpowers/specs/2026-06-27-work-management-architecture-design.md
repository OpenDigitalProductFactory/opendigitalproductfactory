# Company-Level Work Management Architecture

Date: 2026-06-27
Status: Proposed design
Owner: DPF architecture
Related capsule: WC-0A3909A2

## Summary

DPF needs a company-level work architecture that lets people, AI coworkers, and systems share business work without losing state, authority, context, or accountability. The core product object should be a **Work Case** or **Work Packet**: a durable business outcome such as a customer issue, employee request, operational exception, approval, onboarding step, service call, or project activity.

The architectural decision is to make Work Case a company-facing coordination projection and policy envelope over DPF's existing execution substrate, not a new parallel substrate. `WorkItem` remains the queue and routing record, `WorkCapsule` remains the durable execution segment for scoped work, `DecisionInteraction` remains the governed decision ledger, `Principal` and `AuthorityBinding` remain the identity and authority base, and existing activity/evidence records remain authoritative for their own writes. Work Case unifies them into one company-facing object with an opinionated UI, policy envelope, handoff grammar, and receipt projection.

This keeps DPF aligned with the Open Engine insight: the hard problem is not only model capability, but durable handoff boundaries, shared queues, exact stop conditions, and receipts that allow work to leave chat, move across agents and systems, and return with proof.

## Goals

- Define the top-level company work object for DPF without creating a second work engine.
- Make human and AI coworker handoffs first-class: claim, pause, ask, resume, delegate, verify, and close with receipts.
- Establish where WWMD, WWWD, and WSID apply when DPF is operating its own platform versus helping a customer company run work.
- Specify the policy envelope every Work Case/Packet must carry: authority, access, memory, context, handoff, and receipt rules.
- Set a UI architecture for company work that feels native to operators and teams, not like a raw backlog, agent console, or notification feed.
- Identify refactoring needed before implementation so DPF improves its substrate instead of adding another silo.

## Non-Goals

- Do not replace `WorkCapsule`, `WorkItem`, `DecisionInteraction`, `Principal`, `AuthorityBinding`, or Build Studio tracking.
- Do not move platform-development PR/build tracking out of the unified WorkCapsule substrate.
- Do not define every customer-industry workflow. This spec defines the architecture that domain vocabularies and workflows plug into.
- Do not implement schema or UI changes in this spec-only slice.

## Research & Benchmarking

### External Benchmarks

- Open Engine transcript at `C:\Users\Mark Bodman\OneDrive\Desktop\openengine.txt` and [AI agent handoffs](https://natesnewsletter.substack.com/p/ai-agent-handoffs): the relevant pattern is a shared task record with owner, background, allowed actions, stop conditions, evidence, claim/pause/resume states, and receipts. Chat is not the system of record; the task record is.
- [Linear Agents](https://linear.app/developers/agents), [Agent Interaction](https://linear.app/developers/agent-interaction), and [AIG](https://linear.app/developers/aig): agents are native app users, can be mentioned or delegated to, expose session state, and remain visible to humans. Linear's strongest pattern for DPF is that an agent can be a delegate while final accountability remains human.
- [LangChain human-in-the-loop](https://docs.langchain.com/oss/python/langchain/human-in-the-loop): risky tool calls pause through policy, persist state through a checkpointer, and resume with explicit approve/edit/reject/respond decisions. DPF should treat Work Case checkpoints as resumable state transitions, not chat messages.
- [Agent Inbox](https://github.com/langchain-ai/agent-inbox): human intervention benefits from a small action grammar: accept, ignore, respond, and edit. DPF should avoid open-ended "what should I do?" prompts where the action can be constrained.
- [Claude Code overview](https://code.claude.com/docs/en/overview) and [OpenAI Codex CLI](https://developers.openai.com/codex/cli): external coding agents operate across terminal, IDE, desktop, browser, worktrees, MCP, skills, permissions, and sandboxing. DPF should assume work can move across execution surfaces while the company object remains stable.
- [Slack AI docs](https://docs.slack.dev/ai/): agent UX needs native surfaces, bounded autonomy, transparency, context continuity, and clear user control. DPF should make work visible where people already act, but should not let messaging threads become the durable work model.
- [Jira Issues API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/): mature issue systems separate issue identity, workflow status, transitions, permissions, and archive lifecycle. DPF should use explicit transition policy rather than free-form status writes.
- [OpenClaw](https://github.com/openclaw/openclaw), [Hermes Agent](https://github.com/nousresearch/hermes-agent), and [OB1](https://github.com/NateBJones-Projects/OB1): open agent systems are converging on durable memory, cross-channel operation, reusable skills, provenance, scheduled automations, and long-running work logs. DPF should absorb those patterns through its commons, receipt, and context-engineering substrate.

### Internal DPF Substrate

- [Unified Build Studio tracking across all surfaces](2026-06-19-unified-build-studio-tracking-all-surfaces-design.md): `WorkCapsule` is the universal development execution timeline across Claude, Codex, Grok, and Build Studio. Work Case must not contradict that. It sits above capsules for company/business work and can contain one or more execution capsules.
- [Decision Perspective](../../user-guide/ai-workforce/decision-perspective.md): WWMD, WWWD, and WSID already share the `DecisionPerspectiveProfile` and `DecisionInteraction` ledger. Work Case should route decisions through this gate instead of inventing a new decision table.
- [Context engineering and tool efficiency](2026-06-20-context-engineering-tool-efficiency-design.md): Work Case context packets must be bounded, capped, source-referenced, and resumable. They should not replay full chat transcripts by default.
- [Learning propagation commons](2026-06-16-learning-propagation-commons-design.md): durable learnings from work must route to WWMD, WWWD, WSID, code, AGENTS.md, or a skill as appropriate. Private case memory is not the source of truth for reusable knowledge.
- [Issue report surface attendance](2026-06-20-issue-report-surface-attendance-design.md): attention surfaces should classify before projecting, escalate to an active receiver, and carry TAK/GAID-style receipts. Work Case should reuse this signal discipline.
- [Unified identity, access, and agent governance](2026-03-13-unified-identity-access-agent-governance-design.md): effective authority is contextual and flows through principal context, not just the agent's static identity.
- [Trusted AI agent governance white paper](../../architecture/2026-04-18-trusted-ai-agent-governance-white-paper.md): DPF already needs authority, HITL, instruction governance, delegation narrowing, memory/context control, and audit receipts.
- [DAP experience layer](../../architecture/2026-06-09-dap-experience-layer-design.md): long-running process UX should be ambient by default, interrupt by exception, provide re-entry digests, and expose evidence-first review.
- [DPF patterns](../../architecture/dpf-patterns.md): WorkCapsule is a soft lease and concurrency coordination record, not the whole business workflow; GearInterface is a cross-ring observation envelope, not a replacement for local authoritative writes.

## Substrate Verification

The current schema and code already contain most of the required primitives:

- `WorkCapsule` has durable execution identity, executor kind/reference, git and runtime evidence fields, scope claims, workspace state, verification state, runtime targets, runtime verifications, leases, and activity logs.
- `WorkItem` has queue/routing identity, source type/reference, urgency, effort class, worker constraints, assignment, parent/child relationships, evidence JSON, messages, and completion state.
- `DecisionInteraction` has versioned profile binding, route context, phase, question, options, evidence bundle, sources, rationale, risk, confidence, outcome, and human outcome.
- `Principal` provides typed identities beyond user records.
- `AuthorityBinding` provides scoped authority, policy JSON, subject grants, approval mode, sensitivity ceiling, and decision logs.
- `DelegationChain` exists, but it is currently agent-to-agent centric rather than Principal-centric.
- `WorkCapsuleActivity`, `WorkItemMessage`, `RuntimeVerification`, `ExternalEvidenceRecord`, `BacklogItemActivity`, and Build Studio records already hold evidence and timeline fragments, but no common Work Case receipt projection exists.

Two refactoring signals are important:

- `apps/web/lib/queue/queue-types.ts` defines work item source types, while `apps/web/lib/api/work-item-account-resolution.ts` has a separate source resolver registry. This should converge into one source registry before broad Work Case implementation.
- `apps/web/app/(shell)/workspace/my-queue/page.tsx` currently hand-rolls status colors and layout with hardcoded Tailwind colors instead of `report-kit` and `--dpf-*` theme tokens. The attention surface should be refactored before becoming the canonical company-work UI.

## Architecture Decision

Use a **Work Case projection with policy envelope**.

### Option A: Work Case Projection Over Existing Substrate

This option introduces Work Case/Work Packet as the company-facing object and read/write API boundary while reusing `WorkItem`, `WorkCapsule`, `DecisionInteraction`, `Principal`, `AuthorityBinding`, and existing activity/evidence records.

Adopt this option.

Reasons:

- It gives operators and companies the right product vocabulary without duplicating execution state.
- It preserves the existing WorkCapsule decision that development execution is capsule-based.
- It lets DPF add policy, receipts, and UI incrementally.
- It makes refactoring explicit: source registry, receipt projection, status projection, participant/handoff model, and themed attention UI.

### Option B: Treat WorkCapsule As The Top-Level Company Object

Reject this option.

`WorkCapsule` is the right unit for execution and leases, especially platform-development work across coding agents. It is too implementation-shaped to be the primary business object for a customer issue, employee request, appointment exception, or approval. Forcing all company work into capsule language would leak internal execution mechanics into operator UX and would blur accountability.

### Option C: Create A New Parallel Work Substrate

Reject this option.

Adding new Work Case, receipt, decision, participant, evidence, and queue tables as a separate engine would duplicate models DPF already has. It would make current queue, capsule, decision, authority, and evidence records harder to govern and harder to explain.

## Concept Model

### Work Case / Work Packet

A Work Case is the durable company-facing object for an outcome. A Work Packet is a portable subset of a case that can be handed to a human, AI coworker, tool, or external system.

Examples:

- Customer asks to reschedule an appointment and apply a credit.
- Employee needs approval for a non-standard refund.
- Inventory exception needs investigation and vendor follow-up.
- Sales opportunity needs a follow-up sequence and quote review.
- Platform issue report needs classification, reproduction, build, review, and release.

The object answers:

- What outcome is needed?
- Who is accountable?
- Who or what is currently acting?
- What authority is available?
- What context is allowed?
- What decisions are pending or resolved?
- What evidence exists?
- What is blocked, stale, or ready for review?

### WorkItem

`WorkItem` remains the queue and routing primitive. A Work Case can be backed by one primary `WorkItem`, a source record plus projected work items, or a parent work item with child work items.

WorkItem should not become the entire business case model. Its job is assignment, routing, queue state, worker constraints, messages, and local evidence.

### WorkCapsule

`WorkCapsule` remains the durable execution segment. A Work Case can contain zero, one, or many capsules.

Examples:

- A customer service Work Case might not need a capsule if a human resolves it directly.
- A platform defect Work Case might contain a reproduction capsule, a build capsule, a review capsule, and a release verification capsule.
- A business automation Work Case might create a capsule for a scoped AI coworker action with strict authority and stop conditions.

### DecisionInteraction

`DecisionInteraction` remains the decision ledger for WWMD, WWWD, WSID, human approval, ambiguity resolution, escalation, and deferral. Work Case stores decision references and presents them in context; it does not create a new decision log.

### Principal, AuthorityBinding, And Grants

The accountable actor, delegates, reviewers, observers, tools, and systems should all resolve through Principal-aware identity. Authority is derived from `AuthorityBinding`, grants, scope, sensitivity ceiling, and current route context.

Agents should be visible delegates, not invisible assignees. Humans or explicit organizational roles remain accountable for outcomes that require business judgment.

### Receipt

A receipt is the normalized proof envelope for a case event. It can be projected from existing authoritative records before DPF adds any new receipt table.

Receipt fields should include:

- `receiptId` or stable source reference.
- `traceId`, `spanId`, and optional `parentSpanId`.
- `caseId` or source Work Case reference.
- `workItemId`, `workCapsuleId`, `decisionInteractionId`, or other source refs.
- `actorPrincipalId` and, where applicable, `delegatePrincipalId`.
- `authorityBindingId`, grant key, approval mode, and sensitivity class.
- `actionType`, requested action, result, and status.
- Input digests, output digests, evidence refs, and redaction class.
- Stop condition, handoff reason, or completion summary when relevant.
- Timestamp and source system.

## Decision Scope Rules

DPF must resolve "whose judgment is this?" before an agent or coworker acts.

### Platform Tier

Question: how should DPF itself work?

Primary perspective: WWMD.

Examples:

- Architecture decisions.
- Agent governance.
- Tool authorization.
- Build, release, and verification doctrine.
- DPF product UX standards.

WSID may supply craft practice. WWWD may supply install-specific facts. Neither may silently rewrite platform doctrine.

### Company Tier

Question: how would this organization handle this?

Primary perspective: WWWD.

Examples:

- Refund policy.
- Scheduling exception.
- Sales qualification rule.
- Local escalation path.
- Company-specific tone and customer treatment.

WWMD constrains platform safety, product operation, and governance. WSID supplies professional technique. WWMD must not silently answer customer business questions where WWWD exists or should be elicited.

### Job Or Activity Tier

Question: what should a competent role do in this work activity?

Primary perspective: WSID, constrained by WWWD and platform safety.

Examples:

- How a dispatcher triages urgency.
- How a support rep writes a response.
- How a bookkeeper reconciles a variance.
- How an implementation manager prepares a handoff summary.

WSID informs execution quality. It cannot override company policy or platform safety.

## Policy Envelope

Every Work Case or Work Packet should expose a policy envelope. In early implementation this can be a typed projection or JSON envelope attached to the canonical backing record; it should become a typed model only when projection cannot enforce required invariants.

### Required Fields

- `caseRef`: stable case identity. Initially this can be a derived reference from source type/source ID and primary WorkItem ID.
- `caseType`: canonical work category, resolved through the source registry.
- `accountablePrincipalId`: human, role, or organization principal ultimately accountable for the outcome.
- `currentActorPrincipalId`: current human, agent, system, or team acting.
- `decisionScope`: platform, company, job-activity, or mixed, with active profile IDs and fallback order.
- `authorityRefs`: authority binding IDs, grants, approval mode, and sensitivity ceiling.
- `memoryPolicy`: what may be retained, where it routes, retention period, redaction, and commons-routing rules.
- `contextPolicy`: allowed source refs, excerpt/digest limits, freshness requirements, and maximum packet size.
- `accessPolicy`: who can view, act, approve, delegate, export, or archive.
- `handoffPolicy`: claim duration, stop conditions, needs-input behavior, stale timeout, escalation targets, and resume requirements.
- `receiptPolicy`: events requiring receipts and the required evidence fields.
- `definitionOfDone`: outcome-level completion criteria.

### Packet Shape

A Work Packet handed to a human, agent, or tool should be compact and bounded:

- Objective.
- Current state and why it matters now.
- Accountable principal and current delegate.
- Allowed actions and forbidden actions.
- Relevant source refs and short evidence digests.
- Decision scope and authority summary.
- Stop conditions.
- Exact requested response type.
- Definition of done.
- Receipt requirements.

The packet should prefer source handles and short digests over copied transcripts.

## Lifecycle

The Work Case lifecycle is company-facing. It should be projected from WorkItem, capsule, decision, and evidence state without merging their enums.

Recommended case states:

- `intake`: captured but not triaged.
- `triage`: being classified, routed, or scoped.
- `active`: someone or something is working.
- `waiting-on-person`: blocked on a human or external participant.
- `waiting-on-system`: blocked on a system, provider, runtime, or scheduled event.
- `awaiting-decision`: paused for approval, arbitration, or policy judgment.
- `verifying`: checking result or evidence.
- `resolved`: outcome achieved but still inside retention/review window.
- `closed`: completed and archived from active attention.
- `cancelled`: intentionally stopped.

These states must map to, not replace:

- WorkItem queue states.
- WorkCapsule execution states.
- DecisionInteraction outcomes.
- Runtime verification states.
- Source system states.

Transitions should be explicit and policy checked. Free-form state mutation should be avoided for anything that changes accountability, authority, or external side effects.

## Handoff Grammar

DPF should standardize a small set of handoff actions:

- `claim`: actor takes temporary responsibility for the next action.
- `pause`: actor stops with a reason and state snapshot.
- `needs-input`: actor asks one exact blocking question or presents constrained choices.
- `respond`: human, agent, or system supplies the requested input.
- `resume`: actor continues from a paused or input-satisfied state.
- `delegate`: accountable principal assigns a bounded packet to another principal.
- `handoff`: current delegate transfers state to another delegate.
- `escalate`: actor raises a policy, authority, or risk issue.
- `verify`: actor checks result against definition of done.
- `complete`: actor closes the assigned packet with receipts.

Every handoff action should produce or reference a receipt. The UI can expose friendly verbs, but the backend should keep the grammar tight.

## UI Architecture

### Owning Area

Company-level work belongs primarily in `Workspace`, not `Platform`.

- `/workspace` should own "My Work", team queues, cases requiring attention, and operator-facing case detail.
- `/ops` or platform admin surfaces should own system health, install governance, platform issue reports, and DPF operational exceptions.
- `/storefront` remains internal management for storefront/business configuration.
- `/portal` remains external/customer experience.

The product label should be "Work" or "Cases" for general users. "Queue", "Capsule", "Receipt", and "DecisionInteraction" are implementation terms unless the user is in an admin/audit context.

### Primary Surface

The first screen should be an attention lens, not a dashboard:

- Needs me now.
- Running without me.
- Waiting on someone else.
- Awaiting decision.
- Recently resolved.
- Stale or at risk.

Each row should show outcome, accountable principal, current actor, status, due/stale indicator, risk, next action, and evidence confidence. The default action should be obvious and constrained.

### Case Detail

Case detail should be an evidence-first workspace:

- Header: outcome, status, accountable principal, current delegate, priority, and next action.
- Summary strip: why this matters now, deadline/staleness, authority/sensitivity, and decision scope.
- Timeline: receipts, messages, decisions, handoffs, verifications, and source events in one ordered view.
- Context: source records, customer/company facts, relevant WWWD/WSID/WWMD references, and freshness.
- Work: child work items and execution capsules.
- Decisions: pending and completed `DecisionInteraction` records.
- Evidence: artifacts, screenshots, commands, runtime verification, and external evidence refs.
- Audit: authority binding, grants, policy envelope, and redaction/access information.

Default view should show a digest. Raw logs, transcripts, and evidence payloads should be drill-down, permissioned, and redacted.

### Theme And Components

Implementation must use DPF theme tokens and `report-kit` primitives:

- `StatusBadge` for status and risk.
- `DataTable` for dense, sortable case lists.
- `FilterBar` for queue filters.
- `StatCard` only for compact operational counts, not decorative dashboard cards.
- `ExportButton` only where export is permissioned and useful.
- `statusColors.ts` as the single status-to-intent registry.

Hardcoded Tailwind color families such as `bg-red-100`, `text-blue-700`, and local status color maps should be removed from the company-work surfaces. Use `--dpf-*` tokens and semantic status intents.

### Interaction Design

- Every agent action should show what will happen next before it happens when authority or side effects matter.
- Needs-input prompts should ask one exact question or present constrained options.
- Completion should show receipts and evidence, not just "done".
- Stale cases should explain what is stale: context, actor lease, provider state, source record, or decision.
- Mobile should prioritize "needs me now", next action, and digest. Audit detail can be secondary.

## Data And Refactoring Plan

### 1. Canonical Work Source Registry

Create one canonical registry for WorkItem source types and case projection behavior.

It should define:

- Source type key.
- Display label and route owner.
- Domain category.
- Source resolver.
- Account/customer resolver.
- Case title/summary projection.
- Default decision scope.
- Default authority policy.
- Default receipt requirements.
- Supported transitions.

This replaces split source knowledge in queue constants and account-resolution helpers.

### 2. Status Projection Helpers

Add typed projection helpers that map source state, WorkItem state, WorkCapsule state, DecisionInteraction state, and verification state into Work Case state.

Do not merge the underlying enums. The projection should be explainable: every case state should expose why it is in that state and which source record caused it.

### 3. Receipt Projection

Implement a `ReceiptEnvelope` normalizer over existing records first:

- `WorkCapsuleActivity`.
- `WorkItemMessage`.
- `RuntimeVerification`.
- `ExternalEvidenceRecord`.
- `DecisionInteraction`.
- `BacklogItemActivity`.
- Build Studio activity records.
- Tool execution records where relevant.

Only add a persistent receipt table if projection cannot satisfy audit, ordering, retention, or cross-source reference requirements.

### 4. Principal-Centric Handoff Trail

Refactor handoff modeling toward Principal-aware participants.

The current `DelegationChain` is useful but agent-centric. Company work needs handoffs among users, teams, agents, service principals, external participants, and source systems. The first implementation can project participants from existing records, but the durable model should not be limited to `fromAgentId` and `toAgentId`.

### 5. Policy Envelope Types

Create typed policy-envelope definitions under a work-management library module before adding route-level UI. Keep policy shape near domain logic, not inside React pages.

Candidate module:

- `apps/web/lib/work-management/case-types.ts`
- `apps/web/lib/work-management/source-registry.ts`
- `apps/web/lib/work-management/status-projection.ts`
- `apps/web/lib/work-management/receipt-envelope.ts`
- `apps/web/lib/work-management/policy-envelope.ts`

### 6. Workspace UI Refactor

Refactor `workspace/my-queue` before or as part of the first Work Case UI slice:

- Replace local color maps with report-kit status intents.
- Replace ad hoc cards/tables with report-kit primitives.
- Separate route data loading from projection logic.
- Add empty, unauthorized, source unavailable, stale, and provider-blocked states.
- Keep the first viewport focused on work requiring attention.

### 7. Worktree Path Helper

Audit `buildCapsuleWorktreePath` in `apps/web/lib/work-capsules.ts`, which currently returns a `D:\DPF-<slug>` style Windows path. Current AGENTS.md doctrine requires `D:\DPF-worktrees\<topic>`. This is adjacent to WorkCapsule execution reliability and should be corrected in a separate focused change.

## Implementation Slices

### Slice 0: Design And Inventory

This spec.

Deliverables:

- Architecture decision.
- Research and substrate inventory.
- UI and refactoring requirements.
- No code or migration changes.

### Slice 1: Source Registry And Projection Tests

Deliverables:

- Canonical source registry.
- Case state projection helpers.
- Unit tests for current source types.
- No user-visible route change unless needed for compatibility.

### Slice 2: Receipt Envelope

Deliverables:

- Receipt projection over existing records.
- Typed receipt schema.
- Tests proving receipts can be produced from WorkCapsule activity, WorkItem messages, RuntimeVerification, and DecisionInteraction.

### Slice 3: Workspace Attention Refactor

Deliverables:

- `workspace/my-queue` converged onto report-kit and DPF tokens.
- Case-like row projection with current actor, accountable principal, next action, and reason for attention.
- Responsive desktop/mobile QA.

### Slice 4: Case Detail

Deliverables:

- Work Case detail page or panel.
- Digest-first timeline.
- Participants, policy envelope, decisions, capsules, and receipts.
- Permissioned audit drill-down.

### Slice 5: Principal-Centric Handoffs

Deliverables:

- Principal-aware handoff projection.
- Delegation/handoff events with receipts.
- Migration only if projection is insufficient.

### Slice 6: Company Workflow Adoption

Deliverables:

- First domain workflow using Work Case vocabulary.
- WWWD/WSID/WWMD decision-scope validation.
- Canonical runtime UX verification.

## Verification Requirements For Implementation

Future implementation PRs must include:

- Unit tests for source registry and status projection.
- Unit tests for receipt envelope projection.
- Production build for affected Next.js app.
- UX verification across desktop and mobile for Workspace work surfaces.
- Theme scan confirming no hardcoded status colors in new/refactored surfaces.
- Evidence that decision-scope routing uses WWWD/WSID/WWMD correctly.
- If a migration is added, migration apply evidence.

## UX Fit Review

Verdict: fits with guardrails.

Fit:

- The feature belongs in Workspace because it is day-to-day company work.
- The UX should expose business cases and next actions, not raw agent internals.
- Receipts and decisions should be visible but progressively disclosed.
- The attention model should follow the DAP rule: ambient by default, interrupt by exception.

Guardrails:

- Do not create a second dashboard for the same work.
- Do not make chat the state manager.
- Do not expose WorkCapsule as the primary term for customer/company work.
- Do not use platform WWMD as a substitute for customer/company WWWD.
- Do not ship another hardcoded color/status system.

## Architecture Review

Verdict: architecturally sound if implemented as projection-first.

Strengths:

- Reuses existing canonical substrate.
- Separates product vocabulary from execution mechanics.
- Preserves WorkCapsule's role in platform-development execution tracking.
- Elevates authority, memory, access, and receipts to policy rather than page logic.
- Names refactoring before schema expansion.

Risks:

- A projection can become too implicit if it lacks explicit source registry and projection tests.
- WorkItem parent/child relationships may not be enough for all long-running company cases.
- Receipt projection across many tables can hide ordering or retention issues.
- Principal-centric delegation may require schema work after the first projection slice.
- UI can regress into another queue if the first screen is not designed around attention and next action.

Mitigations:

- Build source registry and projection tests first.
- Add a typed persistent Work Case model only after a failing invariant proves projection is insufficient.
- Keep receipt projection source-referenced and explainable.
- Route all consequential decisions through `DecisionInteraction`.
- Use report-kit and UX verification as build-gate evidence for UI work.

## Open Questions

- Should the user-facing term be "Work Case", "Work Packet", or a vocabulary-resolved label by archetype? Recommended: Work Case as the platform concept; allow industry vocabulary to rename it.
- Should the first implementation anchor case identity to parent `WorkItem`, source record, or a derived case ref? Recommended: source registry chooses per source, with a stable derived ref.
- When does projection become insufficient and require a persisted Work Case table? Recommended threshold: when cross-source child work, retention, permissioning, or audit ordering cannot be expressed by existing source refs and indexes.
- Should external customer-visible portal cases share the same architecture? Recommended: yes, but `/portal` should expose a constrained customer view, not the internal Workspace detail.

## Next Step

Create an implementation BI under the unified tracking or attention-surface epic for Slice 1: canonical Work Case source registry and state projection tests. Do not start UI or schema work until that slice lands.
