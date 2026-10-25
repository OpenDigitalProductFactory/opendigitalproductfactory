---
status: active
---

# Bounded deliverable outcomes

Date: 2026-10-25. Backlog: BI-A798975C. Workroom: WC-5D6B124A.

## Purpose and ownership

The owner asked for finite work: agree an outcome, deliver it, close the authoring
thread and move on. New discoveries must not silently replace that outcome.
This extends the existing [objective reconciliation design](2026-08-08-initiative-readiness-and-goal-completion-reconciliation-design.md)
and [delivery closeout contract](2026-09-04-delivery-closeout-cost-efficiency-design.md).
The approval-policy and weekly correction work remains with BI-73780C2E and its
owning chat, Rationalize approval list. No permission or autonomy ceiling changes.

## Objectives

**OBJ-BOUND-1:** Keep an attributable initial delivery agreement and distinguish its completion from follow-on work.

**OBJ-BOUND-2:** Resolve DEV and its paired installation as separate evidence scopes when beginning a deliverable.

**OBJ-BOUND-3:** Show the owner what was agreed, what finished and what remains elsewhere without a new dashboard.

## Acceptance

| ID | Objectives | Statement |
| --- | --- | --- |
| AC-1 | OBJ-BOUND-1 | A finite Workroom captures an immutable delivery agreement with the objective and acceptance/source identity used at start; later objective text and additional findings cannot silently replace it. |
| AC-2 | OBJ-BOUND-2 | DEV deliverable context records whether its declared paired installation was checked, the source/version/time and applicability of guidance, or a named unavailable/denied condition; foreign guidance never becomes local authority automatically. |
| AC-3 | OBJ-BOUND-3 | The existing Workroom view shows agreed outcome, current completion disposition, blockers/owner and follow-on references using accessible progressive disclosure and shared status/report primitives. |
| AC-4 | OBJ-BOUND-1 | Completion evaluates the agreed delivery and emits a durable handoff through existing evidence/terminal paths; unresolved in-scope requirements remain blocked, while separately owned follow-on work does not reopen a delivered room. |
| AC-5 | OBJ-BOUND-1 | Retry/replay, changed objectives, changed or unavailable peer guidance, completed delivery with follow-on work and genuine missing outcome evidence are covered by focused tests; canonical served verification remains distinct from source tests. |
| AC-6 | OBJ-BOUND-1 | Refactoring consolidates agreement parsing, completion/handoff projection and shared source identity instead of adding a second work ledger, approval engine or periodic scan. |

## Contract and data authority

C-BOUND-AGREEMENT: extend Workroom.workspaceState with a versioned agreement;
append the initial agreement and finish handoff to the existing WorkroomActivity
record. A workspace projection is a bounded read model, not another ledger.
The agreement records the initial objective, backlog identity and acceptance
source digest when available. Missing acceptance evidence remains missing.
Normal re-adoption, head refresh and contextual updates preserve the agreement.
A material change is an explicit successor/amendment, never a silent reset.
Existing authorized changes to owners or sensitivity retain their own rules.

C-BOUND-CONTEXT: read current installation stance and the trusted paired-link /
existing mirrored record metadata. Record observation time, origin and freshness.
A mirror is labelled as a mirror; link health is not a claim that guidance was
read. Relevant source documents require explicit source references and a known
retrieval/verification state. If no permitted guidance reader exists, report
unavailable with the responsible next action. Never use peer data as local policy
or allow a DEV verdict to assert a peer customer's business outcome.

C-BOUND-FINISH: preserve the existing terminal-transition repository as the only
completion authority. The agreement/handoff projection does not mint PASS.
An in-scope unmet requirement still blocks. Linked follow-on BIs and pending
operational observation are durable obligations, not permission to reopen a
provider-verified delivered change. Standing rooms keep their cycle contract.

F-BOUND: claim -> retain agreement and context -> execute bounded assignment ->
reconcile existing evidence -> existing terminal transition -> durable handoff.
A changed objective is visible as drift and requires a deliberate disposition.

## UI and scale

Extend the existing room detail and MCP readback with the same projection.
Lead with agreed outcome, finish disposition and next owner/action. Put context
origin, timestamps, identity/digests and follow-on detail behind one keyboard-
accessible disclosure. Reuse report-kit and theme tokens. No polling, network
fan-out on render, new navigation or per-room full history reads.
Read one room and bounded source records. Preserve existing admission, access,
classification and compare-and-set controls. Historical rooms remain readable;
no backfill claims that a historical agreement was captured at work start.
No schema migration or new dependency. Rollback stops new capture/UI projection
while retaining recorded agreement and handoff evidence.

## Grounding and verification

Existing substrate: work-capsule-store, room boundary claims, room-read-model,
workspace-case-loader, instance-stance, federation work-sync metadata,
completeWorkCapsuleTransition and the Outcome Packet.
BI-65D75876 already owns inventory usability; BI-9DC43E17 owns the broad delivery
rail; BI-BCF32886 owns the twelve-carrier execution-continuity program. This item
adds the fixed agreement/context/finish contract without replacing those owners.

V-BOUND: red-green contract tests, boundary/store/replay regressions, room and MCP
projection/component tests, package typecheck, canonical integration and served
finite-delivery verification. Unknown or unrun evidence is reported explicitly.
