---
status: draft
---

# Gated Permissions Process (GPP): design

| | |
|---|---|
| Date | 2026-09-30 |
| Epic | **EP-B932453F** |
| Backlog | **BI-2C3B3AC9** |
| Workroom | **WC-554AAE22** |
| Placement decision | **DI-5E0B3CA09D27** (WWMD, `principle_decide`, high confidence, proceed) |
| Normative owner | [gated-permissions-process.md](../../architecture/gated-permissions-process.md). This spec records why and how; it does not restate the rules. |

## Problem

Mark named GPP on 2026-09-30. The concern is how people govern what AI agents may do with tools.

**There are two common modes today, and both fail.**

- **Per-call approval.** People stop reading the prompts. Anthropic reports users approve 93–97% of them and catch a disguised dangerous command 13.6% of the time (vendor-reported).
- **Blanket approval** ("YOLO" / skip-permissions). The agent's standing credentials become its authority. The 2024–2026 incident record is dominated by this failure, including the July 2026 OpenAI-agent intrusion into Hugging Face.

The [market brief](../../architecture/agent-governance-market-landscape-2026.md) holds the evidence.

**DPF already has most of the parts:**

- work shapes with stages and `governed-decision{decisionScope}` advances
- a `Workroom.decisionScope`
- room-turn authority that only narrows
- grant intersection across agent, user, room and token scope
- an escalation gate
- an enforced WWWD × WSID alignment gate on consequential tools inside rooms
- a projector that turns a sealed scope judgment into an exact-action authorization

**What it lacks is one modeled unit that ties a gate in an owning scope to the tools it admits, at stage granularity, in a form that can be checked for completeness against what the runtime actually allows.**

## Decision

GPP becomes the fourth member of the [standards family](../../architecture/agent-standards-family.md). It owns the **Gated Permission** binding:

> scope gate × capability set × work-shape stage × subject × validity × preconditions × stop conditions × enforcement mode

It also owns the capability vocabulary, the co-occurrence constraints, model completeness checks (C-1…C-7) and efficacy measures (M-1…M-7).

It owns no runtime control:

- TAK enforces.
- GAID identifies and receipts.
- TAK-JSI qualifies.

### Options scored (DI-5E0B3CA09D27)

| Option | Composite | Disposition |
|---|---|---|
| Standalone GPP standard that redefines authorization rules | 3.57 | Rejected. It duplicates TAK §7.2/§8.4 and creates two homes for one rule. |
| **Family member owning only the binding semantic** | **11.33** | **Adopted.** |
| Fold into a TAK section with no public name | 9.64 | Rejected. It loses the legible cornerstone the founder asked for and hides the model from adopters. |

## Research & Benchmarking

Primary and secondary sources were checked on 2026-09-30. Citations are in the market brief. These are design comparisons, not security evaluations.

| Reference | Pattern | DPF disposition |
|---|---|---|
| **AWS Bedrock AgentCore Policy (Cedar)** | Deterministic, default-deny principal × action × resource × context decision on every gateway tool call | **Absorb** the enforcement shape. It already matches DPF's governed-execute deny-ladder. **Reject** adopting Cedar or a new policy engine (absorb-don't-adopt): a GPP binding is engine-neutral and DPF's existing resolver enforces it. Cedar has no notion of where authority originates; GPP adds that. |
| **OpenFGA / Zanzibar (ReBAC)** | Relationship tuples, delegation, consistent checks at scale | **Absorb** the idea that scope membership and delegation are relationships, so bindings can be evaluated per subject. **Reject** a separate relationship store; DPF's principal, participant and delegation-chain records already carry these relationships. |
| **Meta *Agents Rule of Two*; DeepMind CaMeL** | Limit co-occurring capabilities (untrusted input, sensitive access, state change) per session; tag data by capability | **Adopt** the Rule of Two as a model-level constraint (GPP §8, check C-5). **Defer** CaMeL-style value tagging to TAK runtime work. |
| **ITIL change enablement** | Pre-authorized *standard changes* as a class; *normal changes* go to a change authority | **Adopt** the core idea: approval attaches to a class of change and its authority, not to each execution. Cite primary ITIL sources before using this publicly. |
| **arXiv 2606.03518, *Overlaying Governance*** | Compositional delegation types and resource-scope attenuation over relational policies | **Nearest formal prior work.** GPP differs by binding to named governance scopes and versioned work-shape stages. A full comparison is owed before any novelty claim (follow-on). |
| **Anthropic Claude Code auto mode** | A classifier decides which calls proceed without a prompt | **Reject** as the primary control. It is probabilistic, with a published false-negative rate and a published bypass. GPP is deterministic, but a classifier may still be used as defence in depth beneath it. |
| **MCP authorization (OAuth 2.1, RFC 8707) and tool annotations** | Server- and scope-level authorization; untrusted hints | **Compose.** MCP scopes remain the transport credential, and DPF already maps OAuth scopes to granular grants. GPP sits above them; annotations never widen a binding. |

## Mapping to existing substrate

[GPP Annex A](../../architecture/gated-permissions-process.md#annex-a-informative-dpf-realization-status) owns the element-by-element map and current mode. The design consequences are:

1. **Stage granularity.** Work-shape `grants` are per shape today. GPP requires per-stage attachment wherever any stage reaches a consequential capability.
   - Extend `WorkShapeStage` rather than adding a new model.
   - This needs a schema audit before implementation; shapes are code-defined, so no migration is expected.
2. **Vocabulary resolution.** Shape grant tokens must resolve to enforceable grants.
   - The first finding is BI-00588B51: `tool:write-source` resolves to nothing.
   - The C-2 check belongs beside the existing coworker-grant consistency guard (`packages/db/src/coworker-grant-consistency.ts`), not in a new tool.
3. **Gate decision reuse.** The policy-authority projector already turns a sealed scope judgment into a time-bound authorization. Widening it from 11 projectable actions to binding-scoped capability sets is the implementation path for GPP §9.1. That path runs through `resolve-policy-action-authority.ts`, not a new authority engine.
4. **Enforcement mode.** The shape gate is in shadow mode by kernel decision (DI-6D5D686464DC), with promotion gated on operator ratification against shadow telemetry. GPP M-6 (shadow divergence) is the measure that ratification needs.
5. **Evidence.** M-1…M-7 are computable from `AuthorizationDecisionLog`, `ToolExecution`, `DecisionInteraction`, `CoworkerActionEnvelope` and `WorkroomActivity`. One precondition: the about 28 direct `executeTool` call sites that bypass the governed audit must route through it or be declared out of scope.

## Delivery sequence

| # | Deliverable | Owner |
|---|---|---|
| 1 | GPP working draft, family map, alignment and roadmap pointers, market brief (this PR) | BI-2C3B3AC9 |
| 2 | C-2 vocabulary guard plus `write-source` disposition | BI-00588B51 |
| 3 | Public site and user-guide narrative: four cornerstones, coworkers, Workrooms, archetypes | BI-928E1B0F |
| 4 | White paper revision | BI-6CC40F77 |
| 5 | Stage-level bindings, projector widening, C-6 reach reconciliation, M-1…M-7 view | To be filed with an implementation plan after this design is reviewed |
| 6 | Executable GPP-001…012 assertions | BI-2AB781FA (family conformance) |

## Risks

| Risk | Mitigation |
|---|---|
| Overclaiming: a modeled envelope is mistaken for enforcement | Profiles separate Modeled, Enforced and Evidenced; C-7 mode honesty; Annex A states the mode for each element. |
| Bindings too coarse | Reproduces blanket approval inside a room. Stage attachment and subject scope prevent it; M-5 detects it. |
| Bindings too fine | Reproduces approval fatigue at a higher level. M-2 and M-3 monitor it; size bindings to a coherent class of work. |
| Duplicate authority logic | GPP owns no runtime rule. Implementation extends the projector and room-turn authority. |

## Verification for this slice

This slice is documentation only.

**Required checks:**

- documentation preflight guards
- Markdown links
- doc index regeneration
- DCO

**Not established by this slice:**

- runtime changes, migrations or conformance-test passes
- independent review of the draft standard, which remains outstanding

Rollback is a PR revert.

## Scheduled delivery evidence authority repair (BI-D95FD249)

This bounded repair implements the existing GPP stage binding through current
Workroom, ScheduledAgentTask and TaskRun records. It adds no permission store,
DEV bypass, grant, funding decision, or governed reviewer authority.

**OBJ-D95-1:** An admitted delivery author records evidence for its exact live
room and stage without another human envelope, while missing or stale authority
retains its refusal or intended gate.

### Reproduction and chosen approach

On source ref `966b7164fa25544c91980424fb461735b44a23f9`, the existing
room-stage mandate reads persisted role bindings and declared stage writes.
The drive's funded author binding is transient, delivery author stages declare
no evidence mandate, and the scheduler omits room-turn authority. Existing
room-stage, author-autonomy and proposal-interception suites pass 36 tests.
The new `room-stage-mandate.delivery.test.ts` regression fails because a valid
admitted delivery fixture receives `[]` instead of
`["record_workroom_evidence"]`.

Reuse `apps/web/lib/work-management/room-stage-mandate.ts::loadScheduledRoomMandate`,
`apps/web/lib/work-management/author-stage-autonomy-live.ts::loadAuthorStageAutonomy`
and `apps/web/lib/work-management/workroom-drive-checkpoint.ts::readDispatchCheckpoint`.
One shared reconstruction serves
`scheduled dispatch -> attachment -> proposal interception -> reference monitor -> scoped evidence`.
A blanket act boundary would admit unrelated actions; persisting a second
authorization would become stale after revocation. Neither is used.

### Ordered implementation and verification

1. Preserve the first-failing regression and baseline source identity.
2. Capture the existing server-written dispatch checkpoint in TaskRun metadata
   when the scheduler creates the run. Match run, task, room, stage, generation,
   current actor/owner, activity state, expiry and checkpoint provenance.
3. Reuse the live author preauthorization and funding resolver; merge transient
   bindings beneath explicit room bindings. Retain explicit propose/advise
   restrictions, participant membership and current grant intersection.
4. Declare the evidence writer on non-governed author stages and use the shared
   resolver for attachment, proposal interception and reference-monitor steering.
   Match evidence parameters to the source capsule and stage. Carry a narrowed
   room-turn context; it must not create general preauthorized room steering.
5. Cover positive and negative cases through scheduler, proposal and monitor
   paths. Run graph-linked tests, both TypeScript programs, applicable guards,
   canonical shared integration and independent semantic review before a ready PR.
   After the canonical release, verify the scoped path with a negative control.

The implementation parent is **BI-D95FD249**, declared medium/fix. These steps
are atomic: declaration, immutable dispatch capture and all enforcement callers
must agree before the repair can ship safely.

### Acceptance criteria

| ID | Objective | Statement |
|---|---|---|
| AC-D95-1 | OBJ-D95-1 | The admitted non-governed delivery author records internal evidence for its exact source room/stage without creating a new human envelope. |
| AC-D95-2 | OBJ-D95-1 | Explicit propose/advise scope, missing/revoked preauthorization, unfunded work, mismatched actor/room/stage, stale dispatch/checkpoint, canceled/terminal work and governed review decisions retain refusal or their intended gate. |
| AC-D95-3 | OBJ-D95-1 | A current existing approval is neither consumed twice nor discarded; retry returns the stored result and denied actions park rather than mint repeated requests. |
| AC-D95-4 | OBJ-D95-1 | Positive and negative tests cover dispatch through the actual scheduler/proposal/authority path; live DEV verification records real evidence with no operator interaction and a meaningful negative control. |
| AC-D95-5 | OBJ-D95-1 | Use existing substrates; refactor duplicated authority reconstruction instead of introducing a new DEV flag or parallel permit store. |

### Evidence and rollback

Verification references:
- `apps/web/lib/work-management/room-stage-mandate.delivery.test.ts`
- `apps/web/lib/actions/agent-task-scheduler-proactivity.test.ts`
- `apps/web/lib/proactivity/propose-interception.test.ts`
- `apps/web/lib/govern/authority/room-mandate-steering.test.ts`

First-failing command:
`pnpm --filter web exec vitest run lib/work-management/room-stage-mandate.delivery.test.ts`.
Observed: 1 failed, expected the evidence writer but received an empty list.

Wrong-room, wrong-stage, revoked/unfunded, expired, superseded, terminal,
nonmember and governed-writer controls must remain refused or gated. Existing
approval settlement/idempotency remains owned by the governed executor.
Rollback is one PR revert; there is no migration or new live permission data.

### Backlog coverage

Canonical implementation parent: BI-D95FD249. One atomic deliverable D95-R1
covers AC-D95-1 through AC-D95-5. The immutable plan coverage receipt
is recorded through `record_plan_backlog_coverage`; its live receipt is
authoritative and no receipt is claimed before that write succeeds.
