---
status: active
---
# Original UX Critic engagement handoff repair

Backlog: BI-BCBCA8D1. Workroom: WC-6CCF8DAB.
Status: bounded repair design; implementation and acceptance are not complete.

## Problem and verified boundary

On October 25, CE-1FE20783 and CE-724328D6 remain requested. Both have
approvalContext.required=false, no accepted/completed timestamp, no linked
Workroom, execution, proposal or envelope, and no fulfillment/result metadata.
AGT-906 has no active room. createCoworkerEngagement only creates a database row;
request_coworker_engagement exposes no continuation. Thus execution stops between
request persistence and authorized dispatch, before specialist participation.
Generic delegation lacks effective thread_write and cannot repair the CE lifecycle.

The user authorizes DEV repair, execution and return to the routing chat. Existing
E27 ownership released ten fulfillment paths through executed envelope
cmvo1s1sd6cps01muoin9akn6. The exact retired defect BI-BCBCA8D1 is reopened by its
supported lifecycle, with the E27 owner's acknowledgement. No new bug, CE or
review replacement is introduced. E27 and unknown review E85C remain unchanged.

## Existing design and substrate

This implements the existing engagement-fulfillment and attributable-completion
contract in the E27 design at 8c648be41440aa7d5aeaef8e04766fcb08920ac0,
docs/superpowers/specs/2026-09-26-review-instantiation-by-shape-and-criticality-design.md,
sections 7-9. Reuse its partial engagement-task-binding.ts,
engagement-fulfillment.ts and external-coworker-task-adapter.ts, correcting their
known gaps. Its larger review framework, selector activation, authority policy,
unknown-review settlement and other acceptance criteria are outside this repair.

Existing machinery: CoworkerEngagement, TaskRun/TaskNode, governed autonomous
execution, task request digests, durable dispatch, canonical coworker identity,
OAuth authority validation, room admission, Workroom activities and evidence.
Read tools intentionally retain metrics-only audit results. Do not journal raw
source or infer consulted corpus from absent audit payloads. Existing immutable
reader pagination and task execution fencing remain authoritative.

## Objectives

**OBJ-EXEC:** Fulfill the original caller-owned advisory engagement through one
supported governed execution lifecycle, preserving request and authority.

**OBJ-PROOF:** Persist attributable specialist findings with actual read
provenance and deliver them to the requesting Workroom and routing author.

## Ordered repair contract

1. Extend the existing catalog tool with observation and fulfillment modes on an
existing engagementId; retain its original create mode. Validate exact input
shape and return actionable structured failures with next actions. A create
response explicitly says that no contribution has yet executed.
2. Resolve the authenticated original requester, active offer/service/provider,
canonical grants and revocations, funding/contract/approval constraints and exact
room action/content access before assignment. Internal advisory scope grants no
room membership, generic thread authority, write capability or policy exception.
Recheck before dispatch and every governed read. No client chooses an identity.
3. Atomically associate the original engagement and a stable server-derived task
identity with its immutable binding and request digest in the task transaction.
Concurrent/lost-response retries observe the same task. Do not dispatch again
from unknown, completed or uncertain execution. Surface failed, unavailable,
authorization-held and unknown states distinctly, with a concrete remedy.
4. Separate room head/stage identity from reviewed artifact identity. Preserve the
original requestedOutcome, inputPayload and digest. For CE-724328D6 bind the
original f52f119b46acb6748b29c55a23ee0b8490a3cfd6 prototype explicitly. A newer
revision requires the original requester to name the original scope, exact new
artifact and rationale. Append an association; retain prior tasks/findings. No
unknown prior effects may be superseded. Treat free-text source locators as scope
that must be acknowledged, not absent structured fields that permit substitution.
5. Persist compact server-owned read provenance through the existing task
checkpoint/activity machinery after actual successful governed tool execution.
Include task/attempt/fence/provider/tool identity, exact artifact blob and version,
page ranges/cursor continuity and completeness, content digest and length; for
WSID, consulted slug, revision/timestamp and body digest; for calibrated critique
lookup, actual count and grounding. Native MCP and loop adapters use the same
capture boundary. No model-written reference or metrics-only row proves a read.
Fail closed on missing, truncated, reordered, conflicting or incomplete evidence.
6. Run the actual registered UX Critic provider using only the bound source
reader and profession/corpus readers. Persist criteria, findings, limitations,
reviewed artifacts and compact evidence refs on the original task/engagement.
Empty calibrated corpus remains UNGROUNDED. Authority is advisory only.
7. Project completed result and a stable idempotent Workroom return activity in
the same transaction. Readback repairs interrupted projection from persisted
original execution only; it never starts inference. Author response/disposition
is separately attributable and cannot be manufactured by the Critic or repairer.

## Acceptance

| ID | Objective | Statement |
| --- | --- | --- |
| AC-1 | OBJ-EXEC | An authorized low-risk service engagement can execute through a governed catalog lifecycle and return attributable findings and artifact references. |
| AC-2 | OBJ-EXEC | Advisory design critique remains distinct from formal initiative gate receipts; refusal returns a usable supported remedy when needed. |
| AC-3 | OBJ-EXEC | Status requested, running, completed and failed reflect execution and never equate request creation with completed review. |
| AC-4 | OBJ-EXEC | Concurrent admission, lost-response observation and safe retries preserve one original engagement/task; unknown execution is never replayed. |
| AC-5 | OBJ-PROOF | Original f52 scope is retained; a newer revision has an explicit attributable association and cannot be reported as the old request's coverage. |
| AC-6 | OBJ-PROOF | Real AGT-906 execution persists complete source and WSID provenance, actual criteria/findings and explicit empty-calibration/advisory limitations. |
| AC-7 | OBJ-PROOF | The original routing Workroom receives the persisted result and the original routing chat receives it for attributable author response and disposition. |

## Verification and deployment

Regression tests cover refusal before writes, atomic rollback/concurrent CAS,
identity aliases and revocations, source/corpus metrics-only auditing, full
pagination versus truncation, stale room stage/head, explicit revision extension,
unknown effects, crash recovery and idempotent Workroom return. Run affected
unit tests, package typechecks, scope-derived guards and canonical integration
through the governed shared lease; required GitHub checks and protected merge
queue remain in force. Deploy only through request_self_upgrade. Verify current
live readiness before exercising original engagement happy paths. A mock, source
check, passing build or browser test does not fulfill AC-6/AC-7.

Original artifact: OpenDigitalProductFactory/opendigitalproductfactory,
docs/ux-fit/2026-10-12-routing-management/routing-explorer.html at
f52f119b46acb6748b29c55a23ee0b8490a3cfd6,
blob 75b6cae86bfe7ce033dfc1206e660f8002cf31f4, 86306 bytes. Later prototype blob
1eb385f3136491c7ae9903cd32609d30f207495b at routing merge
d45c898a7045c60ea83755a8cf9c7f664f447bf7 is distinct. Existing Oct24 browser
verification routing-a39d518-current-ui-20261024 is engineering evidence only.

Rollback disables new fulfillment admission while retaining compatible readers,
provenance, identity bindings and fences. Never deploy an older writer capable
of producing unfenced effects while a task is unresolved. No new table, service,
provider dependency, grant, identity or runtime configuration is proposed.


## Deployed native reader boundary (2026-10-26 correction)

The original attempt reached Codex but declined the textual tool-call protocol
with no actual source/corpus executions. Tool schemas were present; the native
MCP transport was missing from that adapter. Add an opt-in exact read-only lane
using the existing internal user/coworker/task-fenced MCP session. Stage private
per-child configuration over stdin; require startup, restrict the MCP allowlist
to the three existing readers, disable shell, use the read-only sandbox, and
retain the existing owned-child lifetime and private cleanup. No persistent
credential, new identity, tool grant or operator account configuration is added.

Bind a typed read-evidence completion policy to the server execution lifetime.
Keep the first immutable request packet complete; use the existing actual page,
wiki, calibration and result validator. Fold native audit rows once and never
parse native calls back into duplicate dispatch. Preserve the verified Critic
JSON before unrelated conversational editing. Exhausted evidence budgets refuse
further governed readers. Incomplete source/corpus work is unavailable with an
explicit held, nonresumable missing-proof next action. No initiative writer or
gating authority is invented.

Neither zero governed DB effects nor an ordinary model reply proves absence of
historical unrestricted native effects. Generic proof producers remain owned by
BI-7906C73E. This repair does not manufacture attestation or repeat an unattested
native execution. Original CE724 remains open for a supported finite recovery
disposition and real attributable result; a new revision's review must be
associated separately and cannot silently satisfy the original f52 request.

The execution layer owns the no-argument native session minter, prebound to the
original task identity/fence and fixed read scopes. Routing receives that
capability through the transient policy/session and cannot select new identity
or authority. Missing minter is a transport refusal, not textual-tool fallback.
