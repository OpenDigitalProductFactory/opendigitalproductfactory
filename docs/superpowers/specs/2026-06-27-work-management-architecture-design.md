# Company-Level Work Management Architecture

Date: 2026-06-27
Status: Accepted design; Wave 6 portal drill-down implemented
Owner: DPF architecture
Related capsule: WC-0A3909A2
Epic: EP-2984B02B - Work Case / Company Work Management
Wave 0 BI: BI-40EE7AFD - Work Case source registry, status projection, and read-model skeleton
Wave 0 plan: docs/superpowers/plans/2026-06-27-work-case-wave-0.md
Wave 1 BI: BI-D633F7AF - Work Case governed Actions, receipt envelope, and coverage guard
Wave 1 plan: docs/superpowers/plans/2026-06-27-work-case-wave-1-enforcement.md
Wave 2 BI: BI-WC-WAVE2 - Work Case accountability, staged transitions, and stop conditions
Wave 2 plan: docs/superpowers/plans/2026-06-28-work-case-wave-2-accountability.md
Wave 3 BI: BI-WC-WAVE3 - Workspace attention lens and Work Case detail surfaces
Wave 3 plan: docs/superpowers/plans/2026-06-28-work-case-wave-3-operator-surfaces.md
Wave 4 BI: BI-WC-WAVE4 - Work Case ecosystem and autonomy contracts
Wave 4 plan: docs/superpowers/plans/2026-06-28-work-case-wave-4-ecosystem-autonomy.md
Wave 5 BI: BI-WC-WAVE5 - Work Case adoption workflows and constrained external views
Wave 5 plan: docs/superpowers/plans/2026-06-28-work-case-wave-5-adoption-views.md
Wave 6 BI: BI-WC-WAVE6-DRILLDOWN - Customer-safe Work Case portal drill-down
Wave 6 plan: docs/superpowers/plans/2026-06-28-work-case-wave-6-portal-drilldown.md
Sibling spec: docs/superpowers/specs/2026-06-27-governed-adaptive-playbooks-design.md (the method-improvement pillar that binds to this object)
Experience extension: docs/superpowers/specs/2026-07-26-work-rooms-collaboration-design.md (Work Room as the outcome-bound collaboration projection over a governed Work Case)

## Summary

DPF needs a company-level work architecture that lets people, AI coworkers, and systems share business work without losing state, authority, context, or accountability. The core product object should be a **Work Case** or **Work Packet**: a durable business outcome such as a customer issue, employee request, operational exception, approval, onboarding step, service call, or project activity.

The architectural decision is to make Work Case a company-facing coordination projection and policy envelope over DPF's existing execution substrate, not a new parallel substrate. `WorkItem` remains the queue and routing record, `WorkCapsule` remains the durable execution segment for scoped work, `DecisionInteraction` remains the governed decision ledger, `Principal` and `AuthorityBinding` remain the identity and authority base, and existing activity/evidence records remain authoritative for their own writes. Work Case unifies them into one company-facing object with an opinionated UI, policy envelope, handoff grammar, and receipt projection.

This keeps DPF aligned with the Open Engine insight: the hard problem is not only model capability, but durable handoff boundaries, shared queues, exact stop conditions, and receipts that allow work to leave chat, move across agents and systems, and return with proof.

Two principles, drawn from how Google, Palantir, Microsoft, Salesforce, and ServiceNow are converging on agent management at scale, anchor the design. First, the projection only stays trustworthy if DPF owns the **governed write path**: every consequential transition is a named Action that enforces the policy envelope at runtime and emits a receipt, never a free-form write to the backing record (the Palantir/ServiceNow/Salesforce enforcement-by-construction model, adapted to DPF's conduit posture). Second, the Work Case should **align to the A2A task vocabulary** (durable `Task`, `contextId` grouping, `input-required`/`auth-required` pause states, message-vs-artifact separation, `AgentCard` capability advertisement) so DPF interoperates with the emerging agent ecosystem rather than inventing a parallel model. Agents are first-class principals with a named human sponsor and retained human accountability.

## Goals

- Define the top-level company work object for DPF without creating a second work engine.
- Make human and AI coworker handoffs first-class: claim, pause, ask, resume, delegate, verify, and close with receipts.
- Establish where WWMD, WWWD, and WSID apply when DPF is operating its own platform versus helping a customer company run work.
- Specify the policy envelope every Work Case/Packet must carry: authority, access, memory, context, handoff, and receipt rules.
- Establish the governed write path: consequential transitions mutate the case only through named, runtime-enforced Actions that emit receipts.
- Align the work object to interoperable agent standards (A2A task lifecycle, capability advertisement) and first-class agent identity with a named human sponsor.
- Set a UI architecture for company work that feels native to operators and teams, not like a raw backlog, agent console, or notification feed.
- Identify refactoring needed before implementation so DPF improves its substrate instead of adding another silo.

## Non-Goals

- Do not replace `WorkCapsule`, `WorkItem`, `DecisionInteraction`, `Principal`, `AuthorityBinding`, or Build Studio tracking.
- Do not move platform-development PR/build tracking out of the unified WorkCapsule substrate.
- Do not define every customer-industry workflow. This spec defines the architecture that domain vocabularies and workflows plug into.
- Do not implement schema or UI changes in this spec-only slice.
- Do not build a new architecture-description, diagramming, or process-modeling mechanism. DPF already has a SysML v2 / ArchiMate EA substrate and an IT4IT value-stream model; this design grounds in and communicates through that substrate (see Architecture Grounding) rather than inventing a parallel one.

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

### Enterprise Agent-Management Platforms (2025–2026)

These platforms are the closest analogues to a company-level work object shared by humans, agents, and systems. The consistent message is that a durable, structured work record — not chat — is the system of record, that agents are first-class principals acting under retained human accountability, and that mutation flows only through governed actions.

- [A2A protocol specification](https://a2a-protocol.org/latest/specification/) and [task concepts](https://agent2agent.info/docs/concepts/task/) (Linux Foundation / Google): the A2A `Task` is close to Work Case. A Task has a server-generated `id`, a `contextId` that groups related work, a `status`, produced `artifacts[]`, and optional `history[]`. Its lifecycle includes `submitted`, `working`, pause states such as `input-required` and `auth-required`, and terminal states such as `completed`, `canceled`, `failed`, and `rejected`; terminal tasks cannot accept more messages. A2A separates a `Message` (communication turn) from an `Artifact` (deliverable), and capability is advertised through an `AgentCard`. DPF should align Work Case identity, state, message/artifact separation, and handoff vocabulary to A2A so external A2A agents can participate. A2A (agent-to-agent, opaque, stateful, long-running) composes with MCP (agent-to-tool, schema'd, atomic): expose a deterministic function as an MCP tool and an opaque accountable collaborator as an A2A-style task.
- [Google Gemini Enterprise Agent Platform scale docs](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale), [agent gateway docs](https://docs.cloud.google.com/gemini-enterprise-agent-platform/agents), and [ADK sessions/memory](https://adk.dev/sessions/memory/): Google's production substrate separates runtime, context management, continuous quality improvement, secure execution, sessions, and long-term memory. The useful DPF pattern is not a new Google-specific table; it is the discipline that Work Case context packets are token-budgeted, source-referenced, session-aware, memory-aware, and quality-measured rather than raw transcript replay.
- [Palantir AIP architecture](https://www.palantir.com/docs/foundry/architecture-center/aip-architecture), [AIP Ontology](https://www.palantir.com/docs/foundry/ontology/overview), and [connecting agents to decisions](https://blog.palantir.com/connecting-agents-to-decisions-277dee8ddb40): Palantir's Ontology combines operational objects, actions, functions, security, and decision context in one governed model. DPF should adopt the core enforcement lesson without pretending DPF is the customer's authoritative ontology: for case-consequential transitions, the sanctioned write path is a governed Action that checks policy and emits a receipt.
- [Microsoft Entra Agent ID](https://learn.microsoft.com/en-us/entra/agent-id/what-are-agent-identities), [agent identity governance](https://learn.microsoft.com/en-us/entra/id-governance/agent-id-governance-overview), and [Agent Framework / Magentic](https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/magentic): Microsoft treats agent identities as governable Entra accounts, supports autonomous and delegated access, and assigns sponsors who are human users accountable for lifecycle and access. Magentic adds a manager-led multi-agent orchestration pattern with human-in-the-loop plan review. DPF should persist sponsor and authority-mode invariants for acting agent principals; `authenticated-inbound` is DPF's additional invoker-verification mode for externally invoked cases.
- [Salesforce Agentforce / Atlas reasoning engine](https://engineering.salesforce.com/inside-the-brain-of-agentforce-revealing-the-atlas-reasoning-engine/) and [enterprise agentic architecture](https://architect.salesforce.com/docs/architect/fundamentals/guide/enterprise-agentic-architecture.html): Salesforce frames agents through Role, Data, Actions, Guardrails, Channel, and Atlas's State / Flow / Side-Effects model. Its architecture guidance emphasizes scoped agents, actions as hooks to data/flows/external systems/other agents, MCP, and A2A. DPF should treat guardrails, action scopes, and policy checks as runtime contracts around the reasoning layer, never as prompt-only advice.
- [ServiceNow AI Agents](https://www.servicenow.com/products/ai-agents.html), [Use an AI agent action](https://www.servicenow.com/docs/r/build-workflows/workflow-studio/use-an-ai-agent-action.html), [AI agent security controls](https://www.servicenow.com/docs/r/xanadu/intelligent-experiences/aia-security-implementation.html?contentId=hgOWh2Ywn9MMePictho_7Q), and [AI Control Tower](https://www.servicenow.com/products/ai-control-tower.html): ServiceNow grounds agents in existing workflows and data, exposes supervised/autonomous execution mode on the AI-agent action, configures ACLs and run-as identity, and centralizes agent inventory, governance, runtime monitoring, and value measurement through Control Tower. DPF should make autonomy a per-transition runtime setting, not a global coworker flag.
- [Workday agent system of record](https://www.workday.com/en-us/artificial-intelligence/agent-system-of-record.html), [Airtable agent system of record](https://www.airtable.com/articles/agent-system-of-record), and [CSA Agentic Trust Framework](https://cloudsecurityalliance.org/blog/2026/02/02/the-agentic-trust-framework-zero-trust-governance-for-ai-agents): these sources converge on visibility, governance, lifecycle control, structured operational state, human accountability, access controls, and observable agent decisions. For DPF, the Work Case receipt should prove three things: what data/context the actor relied on, what policy/authority allowed the action, and who remained accountable.

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
- A receipt concept already exists in a narrower scope: `GoldenTriangleReceipt` at `apps/web/lib/golden-triangle/receipt.ts` with a `receipt-store.ts`, plus the receipt-chain model in `docs/architecture/gaid-diagrams/03-receipt-chain.mmd`. The Work Case `ReceiptEnvelope` must be defined as a superset/normalizer that subsumes the Golden Triangle receipt rather than a competing parallel receipt type, or the two will diverge.
- `report-kit` exists at `apps/web/components/ui/report-kit` (co-located in the web app, not a standalone package) and already provides `StatusBadge`, `DataTable`, `FilterBar`, `StatCard`, `ExportButton`, `Chart`, and `statusColors.ts`. No new component library is needed.
- The acting-agent identity primitive is present (`Principal`). Wave 2 adds nullable `sponsorPrincipalId` and `authorityMode` fields to `Principal` as the first persisted accountability invariant. `DelegationChain` remains agent-to-agent centric (`fromAgentId`/`toAgentId`, `originUserId`, `authorityScope`) and still needs principal-aware participant/handoff projection in a later slice.

Two refactoring signals are important:

- `apps/web/lib/queue/queue-types.ts` defines work item source types, while `apps/web/lib/api/work-item-account-resolution.ts` has a separate source resolver registry. This should converge into one source registry before broad Work Case implementation.
- `apps/web/app/(shell)/workspace/my-queue/page.tsx` previously hand-rolled status colors and layout with hardcoded Tailwind colors instead of `report-kit` and `--dpf-*` theme tokens. Wave 3 refactors it into the canonical Workspace Work Case lens backed by `workspace-case-loader.ts`.

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

### The Governed Write Path (the load-bearing reconciliation)

A projection-first Work Case has one structural risk that the enterprise platforms all design against: if the Work Case is purely a read/coordination view over substrate records, then any actor — a human in another surface, an agent with a raw grant, a background job — can mutate the underlying `WorkItem`, `WorkCapsule`, or source record directly and bypass the case's policy envelope. Palantir, ServiceNow, and Salesforce all eliminate this back door by construction: there is no write path except a governed Action/Flow that carries the same access controls as the data. Palantir states it most plainly — an agent "has no path to mutate state except through an Action."

DPF's deliberate divergence from Palantir is legitimate: DPF is a conduit, not the authoritative ontology, and source records remain authoritative for their own writes (see [DPF is a conduit not a broker](../../architecture/dpf-patterns.md)). But that divergence only holds if DPF owns the **governed write path** for case-consequential transitions. State the reconciliation explicitly:

> The Work Case is a projection for read and coordination, but every consequential state transition — anything that changes accountability, authority, autonomy mode, external side effects, or definition-of-done status — is a **governed Action** that is the sole sanctioned mutator, enforces the policy envelope at runtime, and emits a receipt. Free-form writes to the backing records for those transition classes are a governance defect, not a shortcut.

Consequences for the design:

- The handoff grammar verbs (`claim`, `pause`, `delegate`, `escalate`, `complete`, …) are not UI labels over arbitrary updates; they are the **named governed Actions**. DPF already has governed mutators in this shape — `update_work_capsule_status`, `update_backlog_item_status`, `claim_capsule_scope`, `propose_file_change`, and the decision tools — and these should be the Action surface the grammar resolves to.
- Guardrails are enforced **around the reasoning layer** as runtime contracts. Transition preconditions, authority checks, stop conditions, and sensitivity ceilings are evaluated by the Action executor at invocation, never delegated to agent prompt text. This is the DPF kernel rule that governance approves evidence, not provenance, applied to writes.
- Consequential transitions support **staged proposal before commit** (Palantir scenarios; [LangChain checkpointer](https://docs.langchain.com/oss/python/langchain/human-in-the-loop) approve/edit/reject/respond). A proposed transition is a first-class, reviewable, uncommitted state — not a side effect that has already happened by the time a human sees it.
- Where a raw substrate write must remain possible (e.g. a source system of record updates itself), the Work Case treats that as an **observed external event** that produces a projected receipt, and the case is explicit that this write did not pass the envelope. Observed-but-ungoverned and governed-by-Action are distinguishable in the receipt stream.

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

Three identity disciplines from the enterprise platforms should harden this:

- **Named sponsor / accountable human.** Following Microsoft Entra Agent ID and Workday's business-owner model, every acting agent principal carries a named human (or explicit role) sponsor accountable for its lifecycle and for outcomes requiring business judgment. An agent without a resolvable sponsor cannot act on a case unless it is operating under verified `authenticated-inbound` authority. Wave 2 persists this as nullable `Principal.sponsorPrincipalId` and enforces it in the Work Case policy envelope.
- **Authority mode is typed.** Effective authority resolves in one of three explicit modes per the Entra model: **autonomous** (rights held by the agent principal itself), **on-behalf-of** (acting with a delegating principal's rights, bounded by what was delegated), and **authenticated-inbound** (the case can verify which principal — human or agent — invoked an action). DPF currently blends these; the policy envelope should record which mode is in force for the current actor.
- **Authority is derived at invocation, not statically stamped.** Per Palantir's layered model, effective authority for a transition is computed as the intersection of the agent's own scope, the sponsor/on-behalf-of grant, and the case's sensitivity ceiling and route context — evaluated when the Action runs, not read from a grant snapshot taken when the case opened. This is the CSA accountability-lineage triple in operation: every transition traces to the data relied on, the policy that allowed it, and the human accountable.

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

## Architecture Grounding (SysML v2 / EA Substrate)

This design is expressed in DPF's existing architecture substrate so it can be reasoned about, traced to code, and communicated across the platform the same way every other DPF capability is — not as prose or ad-hoc diagrams that drift from reality. DPF already has the modeling capability; this section binds Work Case into it rather than reinventing it.

The substrate (verified): `EaElement`, `EaRelationship`, `EaView`, and the notation registry in `packages/db/prisma/schema.prisma` (notations `archimate4` and `sysml2`), the SysML architecture-note template at [ai-cockpit SysML note](../../architecture/2026-06-14-ai-cockpit-sysml-architecture-note.md), the [SysML v2 reference](../../Reference/sysml-v2.md), the [AI agent meta-model](../../architecture/ai-agent-meta-model.md), and the EA modeling foundation at [phase EA modeling foundation](2026-03-12-phase-ea-modeling-foundation-design.md). Diagrams in this spec are communication aids; the EA graph is the model of record.

### Concept-To-Element Mapping

Each Work Case concept is represented with an existing element type and allocated to the record/code that realizes it (`sysml_allocates`), with stable `infraCiKey` IDs:

- **Work Case lifecycle** → `state` elements + transition edges (state machine `SM-WC-LIFECYCLE`), allocated to `apps/web/lib/work-management/status-projection.ts`. The A2A mapping and terminal-sealing rule are guards/annotations on the transitions.
- **Governed Actions / handoff grammar** → `action` elements (`ACT-WC-claim`, `ACT-WC-delegate`, …), allocated to the existing governed mutators. The proposed-before-commit runtime primitive already exists as `CoworkerActionEnvelope` (status proposed → resolved, with `manifestActionId`, `argsJson`, `rationale`) — Work Case staging reuses it rather than inventing a staging table.
- **Policy envelope** → `constraint` elements (`CON-WC-authority`, `CON-WC-stop`, `CON-WC-sensitivity`), realized by `AuthorityBinding`, `AgentGovernanceProfile`, and `DelegationGrant`. These are the runtime-enforced guardrails, not prompt text.
- **Acting principal + sponsor + authority mode** → `part_definition` (`PART-WC-actor`) with an `interface_definition` port for the capability descriptor (`IF-WC-agentcard`), governed by `AgentGovernanceProfile`. The authority chain is queryable via `run_traversal_pattern` with `governance_audit` and `ai_oversight`.
- **Receipts** → `verification_case` elements (`VC-WC-*`) plus the `ReceiptEnvelope`, which must subsume both `GoldenTriangleReceipt` and the existing `ToolExecutionReceipt` rather than parallel them.

### Requirements And Verification

Seed the design's load-bearing invariants as SysML `requirement` elements so they are traceable and conformance-checked, each closed by a verification case:

- `REQ-WC-1` Governed write path: consequential transitions mutate only through governed Actions → `VC-WC-1` receipt-coverage guard test.
- `REQ-WC-2` Receipt coverage and sealing: every consequential transition emits a receipt; terminal cases are immutable → `VC-WC-2`.
- `REQ-WC-3` Accountable identity: an agent actor without a sponsor cannot transition a case → `VC-WC-3`.
- `REQ-WC-4` A2A alignment: case states and handoff verbs map to the A2A lifecycle including `auth-required` → `VC-WC-4`.
- `REQ-WC-5` Decision routing: consequential decisions route through `DecisionInteraction` → `VC-WC-5`.

### How It Is Communicated And Kept Honest

- Derive current-state Work Case architecture from the source registry, code graph, and schema via the Design-Implementation Parity Engine; hand-author only target-state elements and explicitly tracked gaps. Surface divergence as `EaConformanceIssue`, never silent overwrite.
- Anchor Work Case elements to IT4IT value streams via `itValueStream` (company work is primarily `operate`/`consume`; platform-development cases are `integrate`/`deploy`/`release`).
- Communicate across the platform with the existing tools: `query_ontology_graph` (discovery), `describe_ea_view` (a Work Case viewpoint), `run_traversal_pattern` (`blast_radius` before a change, `architecture_traceability` for intent→code, `governance_audit`/`ai_oversight` for authority), and `export_archimate` for interchange.
- Each implementation slice registers/refreshes its `REQ`/`ACT`/`PART`/`VC` elements and their allocations, so the EA graph stays the single, current explanation of what Work Case is and where it lives.

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
- `sponsorPrincipalId`: when the current actor is an agent, the named human/role sponsor accountable for that agent's lifecycle and authority. An agent actor without a sponsor cannot transition the case.
- `decisionScope`: platform, company, job-activity, or mixed, with active profile IDs and fallback order.
- `authorityRefs`: authority binding IDs, grants, approval mode, sensitivity ceiling, and the active **authority mode** (autonomous, on-behalf-of, or authenticated-inbound) for the current actor.
- `autonomyMode`: per-transition supervised vs autonomous setting (ServiceNow pattern), graduated by the per (coworker × case-type × transition × risk) trust dial rather than set globally. Defaults to supervised for consequential transitions until agreement-rate graduation earns autonomy.
- `stopConditions`: typed, enforced halt conditions — max iterations, cost/budget ceiling (tie to OrchestrationBudget / Golden Triangle), time box, and required-approval gates. The receipt records which condition halted the work.
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

They should also map cleanly onto the A2A task lifecycle so a Work Case can be exposed to or driven by interoperable agents: `intake`/`triage` ≈ `submitted`, `active`/`verifying` ≈ `working`, `waiting-on-person` and `awaiting-decision` ≈ `input-required`, a credential/authorization block ≈ `auth-required`, `waiting-on-system` ≈ a pending/working sub-state, `resolved`/`closed` ≈ `completed`, and `cancelled` ≈ `canceled`/`rejected`.

Two A2A disciplines should carry over:

- **Terminal states are immutable.** Once a case is `closed`, `cancelled`, or otherwise terminal, its receipts are sealed and it cannot be reopened in place. Follow-on work spawns a new linked case (the A2A `contextId` grouping), preserving an honest audit record of what was decided when.
- **Consequential transitions can be staged before commit.** A transition that changes accountability, authority, autonomy mode, or external side effects may exist as a *proposed* (uncommitted) transition awaiting approve/edit/reject, rather than a fait accompli the human reviews after the fact.

Transitions should be explicit, runtime policy-checked, and produce a receipt; per the Governed Write Path, the handoff-grammar Actions are the sole sanctioned mutators for these transition classes. Free-form state mutation must be avoided for anything that changes accountability, authority, autonomy mode, or external side effects.

## Handoff Grammar

DPF should standardize a small set of handoff actions:

- `claim`: actor takes temporary responsibility for the next action.
- `pause`: actor stops with a reason and state snapshot.
- `needs-input`: actor asks one exact blocking question or presents constrained choices (A2A `input-required`).
- `needs-auth`: actor is blocked on a missing credential, grant, or downstream authorization (A2A `auth-required`). Distinct from `needs-input` because the resolver is an authority/grant action, not an answer.
- `respond`: human, agent, or system supplies the requested input or authorization.
- `resume`: actor continues from a paused or input-satisfied state.
- `propose`: actor stages a consequential transition for approve/edit/reject before it commits (staged-before-commit; optional for low-risk transitions, required where the autonomy mode is supervised).
- `delegate`: accountable principal assigns a bounded packet to another principal.
- `handoff`: current delegate transfers state to another delegate.
- `escalate`: actor raises a policy, authority, or risk issue.
- `verify`: actor checks result against definition of done.
- `complete`: actor closes the assigned packet with receipts and seals it (terminal).

Every handoff action should produce or reference a receipt, and — per the Governed Write Path — these verbs are the named governed Actions that mutate the case, not UI labels over free-form writes. The UI can expose friendly verbs, but the backend keeps the grammar tight.

Following A2A's message/artifact separation, the grammar distinguishes a **message** (a communication turn within a case) from an **artifact** (a produced deliverable: a draft, a quote, a built change, a verification result). Closing a case references its artifacts as proof of outcome; conversation turns are not the deliverable and are not what `complete` certifies.

## Observability, Quality, And Agent Governance

The enterprise platforms converge on three governance capabilities that a company-level work object should carry, beyond per-case policy.

### Trajectory, Receipts, And The AgentOps Loop

The receipt fields already specified (`traceId`, `spanId`, `parentSpanId`) align with OpenTelemetry; the design should commit to emitting case events as OTel-compatible spans so Work Case telemetry fits standard enterprise observability rather than a bespoke log. Beyond outcome-and-decision capture, receipts for agent transitions should be able to reference the **trajectory** (the prompt, reasoning, tool selection, and observation sequence) so debugging is possible, with the trajectory held as drill-down, redacted, replayable trace — not promoted into the durable digest by default.

Adopt Google's **AgentOps four-loop** as the governance vocabulary for case types: Measure (completion rate, cost-per-case, latency, escalation rate), Quality (rubric/LLM-as-judge against golden cases, not one-shot pass/fail), Debug (trajectory traces), and Feedback (convert failed or escalated cases into permanent evaluation cases). This closes the loop between receipts and the autopilot trust dial: agreement-rate and quality evidence from receipts are what graduate a (coworker × case-type × transition × risk) cell from supervised to autonomous, and a regression demotes it.

### Session Versus Durable Record

Per ADK's Session/Memory split and the cross-industry "transcripts are source material, structured state is the record" consensus, the design must name the projection/compaction boundary explicitly: which case events are promoted into the durable structured record (the system of record) versus retained only as replayable trace. The Work Case is the structured durable record; chat and trajectory are replayable source material, governed by `contextPolicy` caps. This is consistent with the existing context-engineering spec and prevents the case from silently becoming a transcript store.

### Capability Advertisement

To route and hand off work — including to external/interoperable agents — DPF coworkers and agents should expose an **AgentCard-equivalent** capability descriptor: identity, sponsor, the skills/case-types they can take, input/output modes, security scheme, and whether they support streaming/long-running tasks. This is the routing input the source registry consults when proposing an actor for a case, and the contract that lets an external A2A agent participate as a delegate without bespoke integration. DPF already has coworker capability needs and grants; the AgentCard is the outward projection of that capability state.

### Governing External And Federated Agents

Following ServiceNow Control Tower and Entra, the policy envelope, receipts, and audit must extend to agents DPF did not build — federated peers, customer-installed agents, and third-party A2A participants — not only DPF-native coworkers. A case worked partly by an external agent must still carry sponsor, authority mode, stop conditions, and a receipt stream. This connects to DPF's federation and remote-action convergence work: the same governed-Action write path applies regardless of who the actor is.

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
- `GoldenTriangleReceipt` (`apps/web/lib/golden-triangle/receipt.ts`) and `ToolExecutionReceipt` — the envelope must subsume both existing receipt types, not parallel them.
- Build Studio activity records.
- Tool execution records where relevant.

The envelope must distinguish a **governed-Action receipt** (the transition passed the policy envelope at runtime) from an **observed-event receipt** (an external/raw substrate write the case observed but did not govern), so the receipt stream is an honest audit of what was and was not enforced. Only add a persistent receipt table if projection cannot satisfy audit, ordering, retention, sealing-on-terminal, or cross-source reference requirements.

### 4. Principal-Centric Handoff Trail

Refactor handoff modeling toward Principal-aware participants.

The current `DelegationChain` is useful but agent-centric (`fromAgentId`/`toAgentId`, `originUserId`, `authorityScope`). Company work needs handoffs among users, teams, agents, service principals, external participants, and source systems. The first implementation can project participants from existing records, but the durable model should not be limited to `fromAgentId` and `toAgentId`.

It must also carry, per acting agent principal, a **sponsor** (named accountable human/role) and the **authority mode** (autonomous / on-behalf-of / authenticated-inbound). Wave 2 persists these on `Principal`; `DelegationChain` still needs principal-aware projection beyond `fromAgentId` and `toAgentId`.

### 5. Policy Envelope Types

Create typed policy-envelope definitions under a work-management library module before adding route-level UI. Keep policy shape near domain logic, not inside React pages.

Candidate module:

- `apps/web/lib/work-management/case-types.ts`
- `apps/web/lib/work-management/source-registry.ts`
- `apps/web/lib/work-management/status-projection.ts`
- `apps/web/lib/work-management/receipt-envelope.ts`
- `apps/web/lib/work-management/policy-envelope.ts`
- `apps/web/lib/work-management/accountability.ts`
- `apps/web/lib/work-management/staged-transition.ts`
- `apps/web/lib/work-management/stop-conditions.ts`

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

The slices are resequenced so the invariants that protect the projection — the governed write path, receipt coverage, and accountability identity — land before any operator UI. UI built on an unenforced projection would have to be reworked once enforcement arrives; enforcement built under finished UI is the harder retrofit.

### Slice 1: Source Registry And Projection Tests

Deliverables:

- Canonical source registry (subsumes `queue-types.ts` and `work-item-account-resolution.ts`).
- Case state projection helpers with explainable source attribution.
- Unit tests for current source types.
- No user-visible route change unless needed for compatibility.

### Slice 2: Governed Write Path And Receipt Coverage

Deliverables:

- Inventory of consequential transition classes and the existing mutators that perform them.
- Handoff-grammar Actions wired to those mutators as the sole sanctioned write path, with runtime envelope evaluation (authority mode, sensitivity ceiling, stop conditions) above the reasoning layer.
- `ReceiptEnvelope` normalizer that subsumes `GoldenTriangleReceipt` and projects from `WorkCapsuleActivity`, `WorkItemMessage`, `RuntimeVerification`, `ExternalEvidenceRecord`, `DecisionInteraction`, and `BacklogItemActivity`.
- Receipt-coverage guard/test: a consequential transition cannot complete without an emitted receipt and a passing envelope check; governed-Action and observed-event receipts are distinguishable.
- OTel-aligned span emission for case events.

### Slice 3: Accountability Identity

Deliverables:

- `sponsorPrincipalId` and typed authority mode (autonomous / on-behalf-of / authenticated-inbound) persisted on the acting-principal model; an agent actor without a sponsor cannot transition a case.
- Principal-aware handoff/participant projection generalized beyond `DelegationChain`'s `fromAgentId`/`toAgentId`.
- Authority derived at invocation (agent scope ∩ sponsor/on-behalf-of grant ∩ sensitivity ceiling ∩ route context).
- Migration for the identity fields (the expected first persisted schema change); delegation/handoff events with receipts.

Wave 2 implementation note: `Principal.sponsorPrincipalId` and `Principal.authorityMode` are persisted with a nullable migration, and `apps/web/lib/work-management/accountability.ts` enforces the agent sponsor / on-behalf-of / authenticated-inbound invariants in the policy envelope. Generalized participant projection remains a later hardening task.

### Slice 4: Staged Transitions And Stop Conditions

Deliverables:

- `propose` (staged-before-commit) transition state with approve/edit/reject/respond resolution.
- Typed, enforced stop conditions (max iterations, cost/budget ceiling tied to OrchestrationBudget, time box, required-approval gates); the receipt records which condition halted.
- Lifecycle terminal-state sealing.

Wave 2 implementation note: `staged-transition.ts` and `stop-conditions.ts` provide pure deterministic projection/evaluation helpers. Later write-path slices should connect them to persisted staged transition records and receipt emission as mutators are wrapped.

### Slice 5: Workspace Attention Refactor

Deliverables:

- `workspace/my-queue` converged onto report-kit and DPF tokens.
- Case-like row projection with current actor, accountable principal, sponsor, next action, and reason for attention.
- Responsive desktop/mobile QA.

Wave 3 implementation note: `workspace-case-loader.ts` projects existing `WorkItem` rows into a Workspace Work Case lens without adding a parallel table. `/workspace/my-queue` now renders `WorkCaseAttentionLens` with report-kit stats/status badges, DPF theme tokens, and stable detail links.

### Slice 6: Case Detail

Deliverables:

- Work Case detail page or panel.
- Digest-first timeline.
- Participants, policy envelope, decisions, capsules, and receipts.
- Permissioned audit drill-down.

Wave 3 implementation note: `/workspace/cases/[caseKey]` renders `WorkCaseDetailView`, leading with evidence timeline entries from existing WorkItem evidence/messages before exposing source references. The route is registered as a Workspace detail destination, not a global navigation entry.

### Slice 7: Capability Advertisement And Autonomy Maturation

Deliverables:

- AgentCard-equivalent capability descriptor (identity, sponsor, supported case-types/skills, I/O modes, security, streaming/long-running support) consumed by the source registry for actor routing.
- Per-transition supervised/autonomous mode read from the existing autopilot trust dial; AgentOps measure/quality loop feeding receipts back into graduation.

Wave 4 implementation note: `agent-capability.ts`, `autonomy-envelope.ts`, and `federation-governance.ts` provide pure AgentCard-compatible routing, trust-dial autonomy projection, and federated actor governance contracts over the existing Work Case substrate.

### Slice 8: Company Workflow Adoption And Federation

Deliverables:

- First domain workflow using Work Case vocabulary.
- WWWD/WSID/WWMD decision-scope validation.
- External/federated agent participating in a case under the same envelope and receipt stream.
- Canonical runtime UX verification.

Wave 5 implementation note: `customer-domain-adoption.ts` groups account-resolvable customer Work Cases into WWWD workflow lanes; `portal-case-loader.ts` and `/portal/cases` expose only account-scoped, customer-safe case status; `WorkCaseAttentionLens` now includes a mobile-first attention strip backed by the same Workspace projection. Federation contract work landed in Wave 4; external/customer visibility in Wave 5 is constrained to Portal account scope rather than raw internal source refs.

Wave 6 implementation note: `portal-case-loader.ts` now owns the shared customer-safe case-key/detail projection for Portal list and detail surfaces; `/portal/cases/[caseKey]` renders a constrained single-case digest through `PortalWorkCaseDetail` without exposing internal WorkItem ids, raw source refs, or a new write path. This is the first Wave 6+ long-tail calibration BI: a narrow Portal drill-down extension against the stable Work Case architecture.

## Effort Portfolio (Long-Tail Program)

The implementation slices above are the first concrete build sequence. This section frames the larger program: Work Case is not a single feature but a *pervasive idea* that many prior efforts were independently converging toward. Naming the convergence makes the long tail legible — refactoring that pays down debt this idea exposed, projection work over the current substrate, and new features and surfaces — and shows why the tail keeps narrowing into ever-more-focused refinement rather than ending.

### Convergence: How This Idea Arrived

Work Case did not start as a design; it surfaced as the synthesis several in-flight threads were reaching for from different directions. The architecture is, in effect, the missing object that lets these stop being parallel and start being one:

- Golden Triangle (cost/quality/time compiler, OrchestrationBudget, `GoldenTriangleReceipt`) was already producing receipts and budgets — for a unit it could not name.
- Decision Perspective (WWMD/WWWD/WSID, `DecisionInteraction`) governs decisions — that belong to *something* with a scope and an accountable owner.
- Unified Build Studio tracking (`WorkCapsule`) made execution durable — but only for platform-development work, not company work.
- Coworker orchestration and management consolidation gave actors and an autonomy trust dial — that need work to be accountable *for*.
- Attention surface, DAP experience layer, and issue-report attendance kept rebuilding "what needs me now" — over different records each time.
- Context engineering, learning commons, and unified identity/access governance each defined a policy (context, memory, authority) — that wanted a single envelope to hang on.
- Federation and remote-action convergence pushed work across installs — needing one governed object that survives the boundary.

Work Case is where these meet. That is why it reads as a "next big step": it was being approached incrementally and is only now visible as one thing.

### Two Pillars Of One Idea

The pervasive idea is larger than the Work Case object alone. It has two interlocking pillars, each with its own spec, that together form a governed, evidence-bearing, self-improving work fabric:

- **Pillar 1 — Work Case (the object): where company work lives.** Case identity, policy envelope, governed Action write path, receipts, sponsors, authority mode, A2A-aligned lifecycle. This spec and `EP-2984B02B`.
- **Pillar 2 — Governed Adaptive Playbooks (the method): how agents improve the way that work is done.** Agents propose evidence-backed improvements to their own working methods (Work Patterns); TAK observes, shadows, and promotes only approved, versioned changes. See [Governed Adaptive Playbooks design](2026-06-27-governed-adaptive-playbooks-design.md).

The two are deliberately separate but bind tightly: a playbook that touches company work attaches to a Work Case `caseType`/transition, proposes a candidate **governed Action** (never a free-form write), carries sponsor/authority-mode context, and references `ReceiptEnvelope` and `DecisionInteraction` evidence. The hard dependency runs one direction: **case-bound playbook proposals that change consequential state must wait for this spec's Wave 1 governed write path and receipt-coverage guard.** Agent-level method observation (Pillar 2's own Slices 1–2) can proceed in parallel because it only reads evidence and emits reviewable proposals. This is the same enforcement-before-autonomy discipline that orders the slices below — applied across the two pillars.

### Three Tracks

The program runs as three concurrent tracks. Each has a near-term spine (the slices) and a long tail of focused refinement.

**Track R — Substrate refactor and consolidation** (pay down the "one concept, N implementations" debt this idea exposes):

- R1 Source registry unification (`queue-types.ts` + `work-item-account-resolution.ts` → one registry).
- R2 Receipt consolidation (`ReceiptEnvelope` subsumes `GoldenTriangleReceipt` and `ToolExecutionReceipt`; one receipt model, OTel-aligned, surfaced as SysML `verification_case` evidence).
- R3 Identity generalization (`Principal` gains sponsor + authority mode; participant model generalized beyond `DelegationChain`).
- R4 Governed-Action surface audit (inventory consequential mutators; ensure they are the sole write path; wrap with envelope + receipt emission — composes with the existing ACTION-WRAPPER effort).
- R5 Status projection helpers (one explainable projection from source enums; no enum merging).
- R6 report-kit migration of work surfaces (kill hardcoded color/status maps).
- R7 Worktree-path helper correction (`buildCapsuleWorktreePath` → `D:\DPF-worktrees\<topic>`).
- R8+ (tail) per-source-type registry entries, per-mutator wrapper conversions, per-surface theme migrations — each a small focused change.

**Track P — Projection and governed core over the current substrate:**

- P1 Work Case read/projection API over WorkItem/capsule/decision/evidence.
- P2 Governed write path + receipt-coverage guard (the enforcement spine).
- P3 Policy envelope types + runtime envelope evaluator.
- P4 Handoff-grammar Actions wired to mutators.
- P5 Staged-before-commit transitions.
- P6 Stop-condition enforcement (tie to OrchestrationBudget).
- P7 Receipt normalizer + OTel emission across all evidence tables.
- P8+ (tail) per-transition-class hardening, per-source receipt projections, projection-vs-persistence promotions as invariants demand them.

**Track S — New features and surfaces:**

- S1 Workspace attention lens (primary surface).
- S2 Case detail (evidence-first workspace).
- S3 Work Packet shape and handoff to humans/agents/tools.
- S4 Capability advertisement (AgentCard) and actor routing.
- S5 Autonomy maturation wiring (trust dial per coworker × case-type × transition × risk) + AgentOps measure/quality loop.
- S6 External/federated agent participation + Control-Tower-style governance surface.
- S7 Domain workflow adoption (first vertical; then one per domain).
- S8 Portal constrained customer case view.
- S9 Mobile attention surface.
- S10+ (tail) one focused effort per new domain vocabulary, per coworker capability, per autonomy graduation.

### Waves Of Increasing Focus

The tracks sequence into waves. Each wave is more focused than the last because more of the foundation is fixed; the tail is the steady-state refinement that does not end.

- Wave 0 — Foundations: R1, R5, P1 (+ tests). The projection skeleton. Implemented under `BI-40EE7AFD`.
- Wave 1 — Enforcement spine: R2, R4, P2, P3, P4, P7. The governed write path is the keystone; everything trustworthy depends on it. Implemented under `BI-D633F7AF`.
- Wave 2 — Accountability invariants: R3, P5, P6, S3. Sponsor/authority-mode persisted; staging and stop conditions enforced. Implemented under `BI-WC-WAVE2`.
- Wave 3 — Operator surfaces: R6, R7, S1, S2. UI on a substrate that is already safe. Implemented under `BI-WC-WAVE3`.
- Wave 4 — Ecosystem and autonomy: S4, S5, S6. Capability advertisement, graduated autonomy, federation. Implemented under `BI-WC-WAVE4` as pure contracts over the existing Work Case, trust-graduation, and federation substrates.
- Wave 5 — Adoption: S7, S8, S9. First domains and external views. Implemented under `BI-WC-WAVE5` as customer-domain workflow lanes, constrained Portal case visibility, and a mobile Workspace attention strip.
- Wave 6+ — The long tail: each new source type, domain workflow, coworker capability, portal drill-down, and autonomy graduation is a small, well-scoped BI against a now-stable architecture. The first item, customer-safe Portal case drill-down, is implemented under `BI-WC-WAVE6-DRILLDOWN`; the remaining tail is the calibration loop — increasingly focused refinement that continues indefinitely.

### Program Structure And Governance

- Anchor the program under one epic (Work Case / company work management), with Track R, P, and S BIs linked to it; reuse the unified-tracking and attention-surface epics rather than creating siloed ones.
- Gate the wave boundaries on evidence, not calendar: Wave 1 does not start until the projection skeleton and tests are green; Wave 3 (UI) does not start until the receipt-coverage guard passes.
- Every effort routes its own consequential decisions through `DecisionInteraction` and lands with receipts — the program is itself a Work Case, dogfooding the architecture.

## Verification Requirements For Implementation

Future implementation PRs must include:

- Unit tests for source registry and status projection.
- Unit tests for receipt envelope projection.
- Production build for affected Next.js app.
- UX verification across desktop and mobile for Workspace work surfaces.
- Theme scan confirming no hardcoded status colors in new/refactored surfaces.
- Evidence that decision-scope routing uses WWWD/WSID/WWMD correctly.
- A receipt-coverage assertion: consequential transitions cannot complete without an emitted receipt, and are blocked when the policy envelope (authority mode, sponsor, stop conditions, sensitivity ceiling) fails at runtime.
- Evidence that `ReceiptEnvelope` subsumes `GoldenTriangleReceipt` rather than duplicating it.
- Confirmation that case states and handoff verbs map to the A2A lifecycle (including `auth-required`) and that terminal cases are sealed.
- EA grounding: the slice's `REQ`/`ACT`/`PART`/`VC` elements are registered/refreshed in the EA substrate with `sysml_allocates` edges to the realizing code, `architecture_traceability` resolves intent→code, and no unresolved `EaConformanceIssue` remains for the touched elements.
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
- Do not let any surface write consequential case state outside the governed Action path.
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

- **Projection back door.** If consequential transitions can be written directly to the backing records, the policy envelope is advisory and the case is decorative. This is the highest-severity risk and the one the enterprise platforms design hardest against.
- A projection can become too implicit if it lacks explicit source registry and projection tests.
- WorkItem parent/child relationships may not be enough for all long-running company cases.
- Receipt projection across many tables can hide ordering or retention issues, and can diverge from the existing `GoldenTriangleReceipt`.
- Principal-centric delegation may require schema work after the first projection slice; sponsor and authority-mode are invariants that projection likely cannot express.
- Divergence risk: inventing a parallel state/handoff vocabulary instead of aligning to A2A would isolate DPF from interoperable agents.
- UI can regress into another queue if the first screen is not designed around attention and next action.

Mitigations:

- **Make the handoff-grammar Actions the sole sanctioned mutators for consequential transitions, enforced at runtime above the reasoning layer.** Treat a free-form write that should have been an Action as a governance defect. Add a guard/test that asserts consequential transitions carry a receipt.
- Build source registry and projection tests first.
- Add a typed persistent Work Case model only after a failing invariant proves projection is insufficient; expect sponsor/authority-mode to be the first such invariant.
- Define `ReceiptEnvelope` as a superset of `GoldenTriangleReceipt`; keep receipts source-referenced, explainable, OTel-aligned, and sealed on terminal state.
- Align case states, handoff verbs, and capability advertisement to A2A (`Task`/`contextId`/pause-states/`AgentCard`) so DPF interoperates by default.
- Route all consequential decisions through `DecisionInteraction`.
- Use report-kit and UX verification as build-gate evidence for UI work.

## Open Questions

- Should the user-facing term be "Work Case", "Work Packet", or a vocabulary-resolved label by archetype? Recommended: Work Case as the platform concept; allow industry vocabulary to rename it.
- Should the first implementation anchor case identity to parent `WorkItem`, source record, or a derived case ref? Recommended: source registry chooses per source, with a stable derived ref.
- When does projection become insufficient and require a persisted Work Case table? Recommended threshold: when cross-source child work, retention, permissioning, or audit ordering cannot be expressed by existing source refs and indexes.
- Should external customer-visible portal cases share the same architecture? Recommended: yes, but `/portal` should expose a constrained customer view, not the internal Workspace detail.
- How is the governed write path enforced given source records remain authoritative for their own writes? Recommended: define the consequential-transition classes, route them exclusively through the existing governed MCP/Action mutators with runtime envelope checks, and add a receipt-coverage guard rather than attempting to physically lock the backing tables.
- How far should A2A alignment go in the first slices — vocabulary alignment only, or an actual A2A-conformant task interface? Recommended: align vocabulary and state semantics now (cheap, future-proof); defer a conformant external interface until an external-agent or federation use case demands it.
- Should sponsor and authority-mode be projected or persisted first? Recommended: persist early — they are accountability invariants, not views, and are the most defensible first schema change.
- Where does autonomy-mode graduation live relative to the existing autopilot trust dial? Recommended: reuse the trust dial as the source of truth; the case envelope reads the graduated mode per (coworker × case-type × transition × risk) rather than storing its own.

## Next Step

Continue Wave 6+ long-tail calibration: one focused BI per new source type, domain vocabulary, coworker capability, persisted transition hardening, additional portal/customer drill-down, or autonomy graduation. Treat each tail item as a narrow Work Case extension with its own receipt, UX, and architecture-grounding evidence.
