---
status: active
---

# One Human-Approval Mechanism: Converge on CoworkerActionEnvelope and Retire AgentActionProposal as an Approval Path

- Date: 2026-10-07 (revised after independent review, approve-with-changes: 2 blockers, 12 majors, 8 minors)
- Backlog: `BI-C8EC05C9` (parent `BI-69415B68`, GPP OBJ-MEDIATION; epic `EP-B932453F`)
- Depends on:
  - `BI-5B34D277`, "An approval that is reserved by the gate and then refused before the tool runs is stranded…" (review blocker 1);
  - `BI-4E192035`, "Approving a leave proposal approves the leave even when the proposal recommends denying it". It must land before PR-C.
- Workroom: `WC-69CE571C`, branch `doc/approval-convergence-design`, base `origin/main` `325cc93738`
- Decision: WWMD `DI-0E7ACCB50EAC` chose `converge-on-envelope` (11.31) over `bridge-envelope` (10.34), `route-as-admin` (6.47) and `exempt-allowlist` (4.07). This spec does not reopen that choice.
- Precondition met: BI-0012E6CA (#6087) made envelope lifetimes follow the action's consequence (`apps/web/lib/coworker/approval-lifetime.ts:59-63`).
- Plan: `docs/superpowers/plans/2026-10-07-approval-convergence-on-envelope.md`
- Related:
  - `docs/superpowers/specs/2026-09-01-approval-cards-recommendation-versus-authorization-design.md`;
  - `docs/architecture/gated-permissions-process.md`;
  - `docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md`, PR-H as built, lines 742-801.

## Founder constraints (binding)

1. No approval that works today may stop working.
2. Pending proposals keep their outcome.
3. Leave and proactivity flows are characterised (tests that pin today's behaviour) before they change.
4. No endless breakage: migration without behaviour change comes first.

This design cannot meet constraint 1 in six named places without changing what the platform enforces. They are listed in §10 as **constraint exceptions requiring founder waiver**. PR-B and PR-C are merge-blocked until every waiver has a recorded founder answer.

## 1. Problem

GPP's promotion guard refuses every binding promotion while a dynamic direct `executeTool` site exists (`apps/web/lib/gpp/binding-enforcement.ts:192-199`). Two such sites remain, and both execute an approved `AgentActionProposal`:

- `approveProposal`, at `apps/web/lib/actions/proposals.ts:60-65`;
- `POST /api/admin/ops/execute-proposal`, at `apps/web/app/api/admin/ops/execute-proposal/route.ts:109-114`.

Both are on the shrink-only `KNOWN_UNMEDIATED_EXECUTE_SITES` (`apps/web/lib/gpp/unmediated-execute-sites.ts:87-101`). The ratchet test pins the dynamic set to exactly these two (`apps/web/lib/gpp/unmediated-reach-ratchet.test.ts:35-42`).

Routing them through `governedExecuteTool` today does not work. A call with an `agentId` runs the coworker authority gate (`apps/web/lib/mcp-governed-execute.ts:440-492`). That gate would either park an already-approved proposal or deny it on grants or identity (PR-H as built, plan lines 787-799). The result is two human-approval mechanisms, with different authorisation rules, lifetimes, storage and UI.

## 2. State measured on the live install (read-only SQL, 2026-10-07)

These numbers come from a direct database read (a fallback, with `BEGIN READ ONLY`) against `dpf-postgres-1`.

**AgentActionProposal: 46 pending, 25 executed.** There are no rejected, failed or `approve` rows.

| actionType | pending | executed | oldest pending | newest pending |
|---|---|---|---|---|
| run_hive_scout_ingest | 19 | 10 | 2026-08-21 | 2026-10-06 |
| run_discovery_triage | 13 | 15 | 2026-08-31 | 2026-10-04 |
| record_workroom_evidence | 5 | 0 | 2026-10-04 | 2026-10-06 |
| set_task_goal | 4 | 0 | 2026-09-04 | 2026-10-05 |
| analyze_mcp_call_efficiency | 2 | 0 | 2026-09-01 | 2026-10-07 |
| promote_to_build_studio | 2 | 0 | 2026-09-01 | 2026-09-01 |
| surface_act | 1 | 0 | 2026-10-04 | 2026-10-04 |

- **Where they come from.** Every row has a `prop-` id and a TaskRun, and sits in a `scheduled:*` thread. All of them come from one creation site, S2 (propose-interception in scheduled runs).
- **Age.** 35 of the 46 pending rows are older than 7 days.
- **Owners.** 36 pending rows belong to owner `cmq5kqds…`. The other 10 belong to a second owner, `cmsqa93p…`, who is active, a superuser, and was last seen on 2026-10-07. All 25 executions were decided by the first owner, between 2026-07-18 and 2026-08-23. Nothing has been approved since that date, and new rows still arrive every day.
- **Missing sources.** There are no rows for leave, proactivity change, field dispatch, activity harness, or the chat `AP-` path.

**CoworkerActionEnvelope: 450 rows, all bound.** 89 executed, 233 expired, 90 cancelled, 33 failed, 5 declined.

**`HIVE_OPS_TOKEN`** is unset in `dpf-portal-1`.

## 3. Every AgentActionProposal path today

### 3.1 Creation sites (verified on `325cc93738`)

**S1 — chat proposal-mode tool.**
- Site: `lib/actions/agent-coworker.ts:1992`, fed by `lib/tak/agentic-loop.ts:2302-2335`.
- Raised by: a coworker calling an `executionMode: "proposal"` tool. The loop returns before reaching `governedExecuteTool`. Only the chat caller persists the result. The other loop callers drop it silently (`lib/tak/autonomous-work-run.ts:589`; nothing in `agent-task-scheduler.ts`, `agent-thread-dispatcher-runtime.ts` or `mcp-task-execution.ts` reads `.proposal`).
- `actionType`: the tool name, which is a registered tool.
- Decided by: the inline chat card calling `approveProposal` (`components/agent/AgentCoworkerPanel.tsx:760-799`).

**S2 — propose-interception.**
- Site: `lib/proactivity/propose-interception.ts:177`, called at `agentic-loop.ts:2361-2380`.
- Raised by: any coworker running under a propose boundary. That covers scheduled runs (`lib/actions/agent-task-scheduler.ts:573`) and chat advise mode (`agent-coworker.ts:1304-1305, 1959`).
- `actionType`: the tool name, a registered tool.
- Decided by: the inbox `CoworkerProposalActions` (`components/attention/OwnerDecisionCards.tsx:154-157`) or the chat card, both calling `approveProposal`.

**S3 — activity-harness override.**
- Site: `lib/actions/activity-harness-routing.ts:78`.
- Raised by: **a person** on `/platform/ai/operations-map`, under the synthetic agent id `activity-routing-governor`. That id is not an `Agent` row (live query).
- `actionType`: `activity_harness_confidence_override`. The handler only acknowledges and writes nothing; the tool declares `consequence: "authority"` (`lib/mcp/packs/activity-routing-pack.ts:12-52`).
- Decided by: the inbox, through `approveProposal` and then `executeTool`.

**S4 — field dispatch.**
- Site: `lib/proactivity/field-dispatch-runtime.server.ts:114`.
- Raised by: nobody in production. `proposeUserAwareFieldDispatchNotifications` is called only from its own test.
- `actionType`: `field_dispatch_customer_notification`, which is **not** a registered tool. Approving it would return "Unknown tool" (`lib/mcp-tools.ts:604`).

**S5 — leave.**
- Site: `lib/workforce/leave/decide-proposal.ts:137`, reached through the `propose_leave_decision` tool (`lib/mcp/packs/leave-decision-pack.ts:67`).
- Raised by: the time-off advisor.
- `actionType`: `leave.decide`, a pseudo action rather than a tool.
- Decided by: the manager's own `approveLeaveRequest` or `rejectLeaveRequest` (`lib/actions/leave.ts:91-232`), authorised by `authorizeApprovalDecision`. These settle the proposal row (`leave.ts:13-33`).

`propose_proactivity_change` has decision handlers (`proposals.ts:169-282`, `app/api/v1/governance/approvals/[id]/route.ts:52-76`) but **no creation site**.

### 3.2 Decision paths

| Path | Executes? | Authorisation |
|---|---|---|
| `approveProposal` / `rejectProposal` (`proposals.ts:25-167`) | The generic branch calls `executeTool` with exactly `{ agentId, threadId }` (`:64`). The proactivity branch persists a fact. The leave branch calls `approveLeaveRequest` regardless of the recommendation; `BI-4E192035` fixes this | `requireUser` plus the tool's `requiredCapability`, checked for the **human only** (`:47-50`). Agent grants are not checked |
| `/api/admin/ops/execute-proposal` | `executeTool`, a direct site | A superuser session, or the shared secret `X-Ops-Token`, which impersonates a user with a synthetic `HR-000` role (`route.ts:27-29, 74-82`) |
| `POST /api/v1/governance/approvals/:id` | **No.** It writes `status: "approve" \| "reject"` (`route.ts:79-94`) | Thread owner. Used by the agent-card supervisor panel (`lib/tak/agent-card-service.ts:108`) |

### 3.3 Readers that treat the proposal row as data

- **Activity-routing overrides.** `lib/inference/routed-inference.ts:286-290` and `lib/ai-operations-map/load-map-data.ts:534-538` read rows with status `approve|approved|executed`. The proposal row *is* the override store.
- **Leave recommendations.** `lib/workforce/leave-data.ts:136-151`.
- **Counts and lists.**
  - `lib/workspace-home/command-center.ts:400` counts pending rows.
  - `lib/tak/agent-card-service.ts:308` lists pending rows per agent.
  - `lib/evaluate/proposal-data.ts` builds the Action History.
  - `lib/attention/sources/agent-proposal.ts:143-150` lists every pending row to every operator, with no user scoping (`audience: { operator: true }`, e.g. `:109`).
- **Build.** `lib/mcp/packs/build-ops-pack.ts:398` stamps `gitCommitHash` on approved `propose_file_change` rows.
- **Retention.** `lib/operate/retention/policies.ts:116` deletes proposals with purged threads. This design leaves it unchanged.

## 4. The envelope path this converges on

| Step | Code |
|---|---|
| Escalation: a declared proposal always goes to a person (branch 1) | `lib/govern/authority/escalation-gate.ts:190-192` |
| Evaluator order: capability, grant, room, delegation, route, subject and data policy are checked **before** approval, so an approval never widens authority | `lib/govern/authority/coworker-authority-decision.ts:372-458` |
| Mint: binding fingerprint, consequence lifetime, one active request per binding, and a pause of the bound TaskRun on both the reuse path and the create path | `lib/coworker/authority-approval-envelope.ts:123-204` (pause at `:162` and `:202`); gate `coworker-tool-authority-gate.ts:423-445` |
| Honour: an approved envelope for the identical binding is allowed while fresh | `resolve-coworker-tool-authority.ts:514`; `coworker-authority-decision.ts:458-490`; `approval-lifetime.ts:76-84` |
| Spend once: a compare-and-set reservation, then finalisation after the handler | `coworker-tool-authority-gate.ts:465-473`; `mcp-governed-execute.ts:708-712`; `authority-approval-envelope.ts:333-345` |
| Replay: an identical binding settled within 15 minutes returns its recorded outcome | `authority-approval-envelope.ts:281-322`; gate `:424-425` |
| Decide: only the delegating user may decide, and a decision after the window settles as `expired` | `lib/coworker/envelope-actions.ts:78-87, 95-108, 117-173` |
| Run on approval: **external MCP only**. The approve route calls `runApprovedExternalRequest` (`app/api/agent/envelope/[envelopeId]/approve/route.ts:54`). A TaskRun-bound envelope resumes an external task (`approved-request-run.ts:86-88`). A binding with a `routeContext`, `taskRunId` or `chainId` is `task-bound` and does not run (`:91`) | |
| UI: the inbox card `CoworkerEnvelopeApproval` inside `OwnerDecisionCards`; Expired-unanswered and Ask again (`lib/coworker/envelope-reraise.ts`) | |

Two gaps matter for convergence.

**Gap 1: platform-origin envelopes never run.** No code runs an approved envelope that a platform-origin call raised, whether from chat or a scheduled run. `approvalPendingResult` nevertheless promises that the approved call "runs once" (`lib/govern/authority/approval-pending-result.ts:40-51`). `approveProposal` runs the call at the moment of approval, so convergence must supply the equivalent.

**Gap 2: a reserved approval can be stranded (`BI-5B34D277`).** After the gate reserves an approved envelope, four exits return before the handler runs:
- pre-tool hooks, `mcp-governed-execute.ts:496-526`;
- TAK alignment and preconditions, `:536-548`;
- an enforced permit refusal, `:586-603` (unreachable while `GPP_BINDING_ENFORCEMENT` is empty);
- receipt reservation, `:606-632`.

None of them finalises the envelope. Every retry is then told "approval already used" until the envelope expires (`coworker-tool-authority-gate.ts:465-473`). A runner built on this path would strand approvals the same way.

## 5. Design decisions

### D1. The monitor raises an envelope bound to the exact call

No creation site writes envelope rows itself. Each converted site calls `governedExecuteTool`. The gate decides `require-approval` and mints through `ensureAuthorityApprovalEnvelope`, with the fingerprint set to `fingerprintCoworkerApprovalBinding(buildCoworkerApprovalBinding(input))` (`coworker-authority-decision.ts:279-304`). This yields one minting path, one `AuthorizationDecisionLog` row, one park `ToolExecution` row, and the GPP shadow permit on approval (`lib/gpp/bindings.ts:75-86`).

### D2. Per-site mapping

**S1 — chat proposal-mode tool.**
- **Scope.** The change applies when `interactionMode === "chat"` only (`agentic-loop.ts:987, 1106`). The pre-monitor return at `:2302-2335` stays for autonomous callers, whose behaviour is unchanged and is characterised in A1. Those callers silently drop a proposal today; FU-7 records that.
- **Recommendation: scope to chat.** Changing every caller would turn silent drops in the scheduler, dispatcher, MCP task execution, autonomous work runs and certification into new human cards on the founder's inbox. That is a behaviour change this item does not need.
- **Mechanics.** In chat, the call goes to `governedExecuteTool` (`:2415`), and branch 1 mints the envelope. The context carries `approvalCompletion: "platform"` and `chatMessageId` (the pre-allocated `agentMessageId`, `agent-coworker.ts:1949`). An `approval_required` with reason `declared-proposal` ends the turn and returns `pendingApproval: { envelopeIds }`. A `settled` result renders the recorded outcome and shows no card.
- **`resultEntityId`.** The platform runner returns the handler's `entityId`, so the panel's follow-up keeps today's "Result: <id>" text (`AgentCoworkerPanel.tsx:782-788`).
- **`autoApproveWhen`** behaves as today, because pre-authorised calls already reach the gate.
- **UI.** An inline list of envelopes for the message's `chatMessageId`, each with Authorize and Decline, rendered from `serializeMessage` (`lib/tak/agent-coworker-data.ts:29`) and the shared decision surface of `CoworkerEnvelopeApproval`. The same envelopes appear in Needs-you.

**S2 — propose-interception.**
- **Mechanics.** The loop calls `governedExecuteTool` with server-set `proposeBoundary: true` and `approvalCompletion: "platform"`. The predicate `shouldProposeToolCall` (`propose-interception.ts:54-62`) is unchanged, except that tools with `writeOnly` inputs are refused rather than diverted (D9, waiver W5).
- **New escalation branch, placed right after branch 1:** `proposeBoundary → human`, reason `propose-boundary`. It is tighten-only: it reproduces the diversion that exists today. Under `proposeBoundary` the resolver also sets `policyProjectionAllowed: false` (`resolve-coworker-tool-authority.ts:451`, read at `policy-action-judgment.ts:96`), so no policy projection can approve a proposal on a person's behalf.
- **No pause.** The envelope stores `argsJson.proposeBoundary: true` as metadata. This is deliberately **not** part of the binding, so no existing fingerprint changes. Both pause sites (`authority-approval-envelope.ts:162` reuse, `:202` create) skip `pauseBoundTask` when the active envelope carries that flag. The gate likewise skips `resumeApprovedTask` for such an envelope.
- **Why both sites matter.** The scheduler's forced fallback re-calls the required tool with the same TaskRun (`agent-task-scheduler.ts:598-617`, through `executeAutonomousWorkTool`, `lib/tak/autonomous-work-run.ts:702-709`). Its binding collides with the boundary envelope and would otherwise hit the reuse-path pause at `:162`. In every other respect the fallback behaves exactly as today.
- **Return to the model, by gate outcome:**
  - `approval_required`: today's synthetic success, now with the envelope id and its expiry, and "if nobody answers it shows as expired and can be asked again".
  - `allow`: an approved envelope for this exact call already existed, so the tool **has run**. Return its real result.
  - `settled`: return the recorded outcome.
  - Any denial or evidence failure: a not-run `success: false` result. The tool never executes.
- **Assistant message.** The thread's assistant message "Proposed `X` for your approval." (`propose-interception.ts:101-107`) is **kept**.
- **UI.** The Needs-you envelope card, plus the inline card in chat advise mode.
- **Named deltas:**
  - (a) A `success: false` refusal (grant or identity, waiver W2) now counts toward the scheduler's playbook `partial` verdict (`agent-task-scheduler.ts:634-647`). It does not count toward `detectScheduledRunFailure`, which reads persisted successful rows (`:627-628`). Today the only `success: false` from a divert is `propose_divert_failed`.
  - (b) The synthetic result carries `envelopeId` instead of `proposalId`.
  - (c) The wording adds the expiry.

**S3 — activity-harness override.**
- **Why not an envelope.** A person raises this, under a synthetic agent the authority gate can never verify (`agent-identity-missing`). It is not a coworker action.
- **Recommendation.** As with PR-H's `/ops/demand`, the operator's confirm runs `activity_harness_confidence_override` through `governedExecuteTool` as a direct human call (no `agentId`, `source: "rest"`). This is the same `view_platform` `can()` decision as today (`activity-routing-pack.ts:28`).
- **Storage.** On success, the override is stored as a **durable configuration fact**, following the `persistProactivityFact` pattern (`lib/proactivity/proactivity-override-preferences.ts:57-80`): a `UserFact` with category `activity-routing-override`, keyed by activity class and recipe, superseded on change.
- **Correction to the first draft.** It claimed the consequential receipt "keeps the override". It does not. Receipts hold digests (`outputDigest`, `packages/db/prisma/schema/ai-coworker.prisma:1298`), and `ToolExecution` is purged under retention (`lib/operate/retention/policies.ts:146-173`).
- **Readers.** `loadApprovedActivityHarnessOverrides()` unions the new facts with legacy proposals, filtered to the successful statuses (`approve|approved|executed`). Overrides approved before the change keep applying.
- **UI.** A confirm on the operations map. Founder question Q1 asks whether a second-person check is wanted.

**S4 — field dispatch.** Characterise it, then delete the persistence function, which has no caller and names a tool that does not exist. Keep the pure draft builder, `field-dispatch-runtime.ts`.

**S5 — leave recommendation. This is not an envelope.**
- **Why.** An envelope lends the delegating person's authority to a coworker for one exact call. A leave decision is the manager's own act under HR approval authority (`authorizeApprovalDecision`, `lib/actions/leave.ts:100-118`), and the coworker only recommends.
- **No second WWWD routing.** The org-business judgment already runs through the Decision Perspective Gate when the recommendation is formed (`evaluateOrgBusinessDecisionGate`, `leave-decision-runtime.ts:7, 89`). That decision is linked from `LeaveRequest.decisionInteractionId`.
- **Recommendation read.** Read through `LeaveRequest.decisionInteractionId` → `DecisionInteraction`. **No hand-written ledger rows.**
- **Manager decision write.** The manager's approve or reject is recorded as the **resolution** of that DecisionInteraction through `recordDecisionOutcome` (`lib/decision/decision-outcome-store.ts:109`). That function syncs the shadow ledger through the existing bridge (`decision-outcome-store.ts:173`; persistence bridge `lib/decision-perspective/persistence.ts:359-366`).
- **Guard-only recommendations.** When a hard guard fires, the coworker returns `escalate` with `interactionId: null`, and no DecisionInteraction exists (`lib/workforce/leave/leave-decision-coworker.ts:112-121`). These carry no judgment, only rails. The leave surface evaluates them at read time with the same pure `evaluateLeaveGuards` over current facts, and shows "Needs a human approver: <reasons>". Named delta: the reasons reflect facts at the time of reading, not at the time the proposal was made.
- **Assistant message.** The leave thread's assistant message ("Time-off recommendation: …", `decide-proposal.ts:125-136`) **stays**, written without a proposal.
- **Needs-you.** The item moves from `agent-proposal` to `business-approvals`, deduplicated by `requestId` so legacy and new items never double up.
- **Audience leak.** Keeping the "same audience" keeps a scoping leak: every operator sees every leave item (`agent-proposal.ts:109`). It is recorded as FU-8 and not widened here.
- **Sequencing.** `BI-4E192035` (approve-regardless) lands before PR-C and updates the A1 leave characterisation to the fixed behaviour.

**`propose_proactivity_change`.** It has no creation site. Its legacy handlers never call `executeTool`, so they stay unchanged and keep any pending row on any install decidable.

### D3. Approved platform-origin envelopes run once, through the monitor

`runApprovedPlatformRequest(envelopeId)` in `lib/coworker/approved-request-run.ts`.

**Dispatch.** The approve route checks the park row for the `_approvalResume` marker **first**, before `runApprovedExternalRequest` and its TaskRun branch (`approved-request-run.ts:86-88`). A converted S2 envelope carries a `taskRunId`, but it must not be routed to the external-task resume. Without the marker, behaviour is unchanged.

**Marker contents.** The marker is server-written by `writeGovernedToolAudit` only when `approvalCompletion === "platform"`, and is excluded from tool arguments through `GOVERNED_AUDIT_PARAMETER_KEYS`. It records:
- the original **source**. The runner takes the source from the marker, never from the row's `executionMode`, because Ask again rewrites that column to `"proposal"` (`envelope-reraise.ts:238-243`; the parameters, marker included, are copied);
- the server-set booleans `coworkerReadBaseline`, `coworkerAuthorizedSurfaceBaseline` and `proposeBoundary`;
- `workroomId` and `featureBuildId`;
- the external-access **inputs**: room id and standing-grant reference. These are inputs, not the resolved boolean.

**Run steps:**
1. Require `approved`, an unexpired window, a park row with `error: "approval_required"`, `apiTokenId: null`, and the marker.
2. Read the arguments with `originalToolParameters` and require that their `fingerprintCoworkerInput` equals the binding's input fingerprint. Otherwise return `not-run: arguments-not-provable` (waiver W5).
3. Replay identity from the row and the binding: `delegatingUserId`, `agentId`, `threadId`, `taskRunId`, `routeContext`, `delegationChainId`, plus the marker fields. **Re-resolve** every authority-bearing fact with the original server resolvers: external access from the recorded inputs, room authority, and grants.
4. Call `governedExecuteTool`. The gate honours (D4), reserves, runs and finalises.
5. Write the thread system message, as `proposals.ts:99-111` does today, and return `{ status, message, entityId }`. The **route** records `approval_outcome` exactly once (`approval-outcome-store.ts:20-34`). The runner never records it, and convert-and-run (D5) records it once itself.

**Precondition.** `BI-5B34D277` must be in place. Every exit after a successful reservation finalises the envelope as `failed`, with the refusal recorded as its outcome, and the runner and convert-and-run report that outcome. Without it, a hook or alignment refusal strands the approval.

### D4. How the gates treat a human-approved envelope: reuse the honour path, add nothing

The approved run arrives with the same binding. Escalation still says `human`, the resolver finds the approved envelope, and the evaluator allows it. The gate's compare-and-set spends it once.

There is no new bypass, flag or allowlist. Grants, identity and room are evaluated before any envelope exists (`coworker-authority-decision.ts:372-445`), so a converted request whose coworker lacks the grant is refused at raise time (waiver W2).

### D5. Legacy pending proposals: the outcome is kept, the execution is mediated

The item's drain ("through the existing direct path until empty") cannot be made true deterministically on every install. This design instead mediates legacy execution and keeps the decision with the person.

**Convert-and-run** replaces the generic branch of `approveProposal`, and the superuser branch of `execute-proposal` shares the same core:

1. **Compare-and-set on the proposal row first.** `updateMany({ where: { proposalId, status: "proposed" }, data: { status: "approved", decidedAt, decidedById } })`. A count of 0 returns "Proposal already decided". This closes the double-click race that today's read-then-update (`proposals.ts:34, 55-58`) leaves open.
2. **Call `governedExecuteTool` with exactly today's handler context:** `{ agentId, threadId }` (`proposals.ts:64`), with `taskRunId` and `routeContext` null, the **approver** as user, `source: "rest"`, and `approvalCompletion: "platform"`. No "forced human escalation" is used. The first draft relied on one, but nothing provides it. The gate decides as it would for any call.
3. **Handle every gate outcome explicitly:**
   - `allow`: escalation was automated (for example, a graduated coworker), so the tool **has already run**. Map its result to `executed` or `failed`.
   - `approval_required`: the monitor minted an envelope delegated to the approver. `approveEnvelope(envelopeId, approver)` succeeds (caller equals delegate), then `runApprovedPlatformRequest` runs it. Map that result.
   - `settled`: map the recorded status (`executed` or `failed`) and result.
   - A denial or evidence failure: revert the row to `proposed` with a compare-and-set on `approved`, and return the refusal to the card ("This request can no longer run as proposed: …", Decline only). Nothing runs that authority forbids (waiver W2).
4. Update the row as characterised: `executed`/`failed`, `executedAt`, `resultEntityId`/`resultError`, the system message, and `AuthorizationDecisionLog`. Record `approval_outcome` once.

**Unchanged:** legacy reject, the proactivity and leave handlers, and the v1 route. None of them executes.

**Lifetimes do not bite.** Approval happens in the same request that mints the envelope, so 15-minute or 7-day windows cannot expire a legacy approval.

### D6. When the sites leave the shrink-only list

The sites leave in **PR-C**. After convert-and-run, neither file contains a direct `executeTool` call. PR-C removes both entries from `KNOWN_UNMEDIATED_EXECUTE_SITES`, makes the ratchet expect zero dynamic sites, deletes the `X-Ops-Token` branch (waiver W3), and depends on `BI-5B34D277` and `BI-4E192035` having merged.

After PR-C, `promotionRefusals` returns no dynamic-site refusal. Promoting a binding stays its own reviewed PR under GPP Annex A.

### D7. Lifetimes by consequence

Converted requests use `approvalLifetimeMs(consequence)` unchanged. There is no second taxonomy (`approval-lifetime.ts:10-13`).

| Tool | Declared consequence (pack definitions) | Window |
|---|---|---|
| run_hive_scout_ingest, contribute_to_hive, contribute_finding_to_hive | outward | 15 min, then Expired unanswered and Ask again for 7 days (`EXPIRED_APPROVAL_RESURFACE_MS`, `:50`). Waiver W1 |
| run_discovery_triage, record_workroom_evidence, set_task_goal, surface_act, promote_to_build_studio, analyze_mcp_call_efficiency, propose_improvement, propose_skill_improvement, wiki_ingest, publish_wiki_overlay_pages, start_deliberation | none declared | 7 days, then Ask again for 7 days. Waiver W4 |

The A2 inventory pins this table from `classifyConsequentialTool`, so per-call narrowing is caught.

### D8. Data and retirement: nothing destructive, history kept

- **No schema migration.** The design uses `CoworkerActionEnvelope.chatMessageId`, `DecisionInteraction`, `UserFact` and the envelope's `argsJson` metadata as they exist. The new escalation reason is a TypeScript constant, not a Prisma enum.
- **AgentActionProposal keeps every row.**
  - After PR-B, nothing creates rows. A source guard enforces this.
  - After PR-C, nothing executes directly.
  - The model, the dual-read readers and the legacy non-executing handlers stay.
- **Dual-read** covers:
  - activity-routing overrides;
  - leave recommendation;
  - Action History (`lib/evaluate/proposal-data.ts`);
  - `command-center.ts:400`, which counts pending proposals plus pending converted envelopes;
  - `agent-card-service.ts:308`, which shows the latest pending proposal or envelope per agent.
- **`propose_file_change` stamping** (`build-ops-pack.ts:398`) becomes dead code once no new rows are created. Recorded as FU-6.
- **Table retirement** is out of scope (FU-5).

### D9. Duplicates, unprovable arguments, and transports

- **Duplicates.** An identical binding settled within 15 minutes returns `settled` (`authority-approval-envelope.ts:281-322`):
  - S1 renders the recorded outcome with no card;
  - S2 returns the recorded result to the model;
  - convert-and-run maps the recorded status onto the proposal.

  Scheduled duplicates carry distinct `taskRunId`s, so they are distinct bindings and distinct cards, as distinct proposals are today. An identical **active** request reuses one card (`:156-164`).
- **Unprovable arguments.** The A2 inventory asserts that every proposal-reachable tool either has `auditClass !== "metrics_only"` (derived at `lib/tool-audit-helpers.ts:4-13`; side-effecting tools default to `ledger`) or sets `retainAuditParameters`, so that parameters survive on the park row. Tools with `writeOnly` inputs (today only `configure_and_test_discovery_connection`, `lib/mcp/packs/discovery-inventory-pack.ts`) are **refused under a propose boundary** with "this action needs a secret and cannot be queued; ask the owner to run it". This is better than queuing a request that could never run, or storing the secret in plaintext the way a proposal does today (waiver W5). String leaves over 64 KB are bounded in audit (`lib/evidence/bounded-evidence-output.ts:54`) and fail closed to `not-run` (W5).
- **Transports.** `proposeBoundary`, `approvalCompletion` and `chatMessageId` are server-only context. An adapter test asserts that `/api/mcp/v1` (which reads only `permitHandle` from `_meta`, `app/api/mcp/v1/route.ts:476, 577`) and `/api/mcp/call` never map client input into them.

## 6. Objectives and acceptance

**Objectives:**
- **OBJ-CONVERGE:** every coworker action that needs a person is a `CoworkerActionEnvelope`, and no code creates an `AgentActionProposal`.
- **OBJ-MEDIATION** (GPP, parent): zero dynamic direct `executeTool` sites.
- **OBJ-NODISRUPT** (GPP): no approval that works today stops working, except the waived exceptions in §10, and every pending proposal keeps its outcome.
- **OBJ-HISTORY:** all proposal history stays readable, with no destructive data change.

| ID | Acceptance | Phase |
|---|---|---|
| AC-CHAR | Characterisation suites for S1 (chat and every autonomous caller), S2, S3, S4, S5, proactivity change, the v1 route, both direct sites and the leave settle path. Green on the base, and unchanged by later PRs except the deltas each PR names | A |
| AC-INVENTORY | Consequence → window table. `writeOnly` tools. Audit class or `retainAuditParameters` for every proposal-reachable tool. Proposal-reachable ∩ `PROJECTABLE_ACTIONS` = ∅ | A |
| AC-PROBE | A read-only per-row dry run of the real resolver and evaluator, GAID principal resolution, hook verdicts and alignment-required, with a refusal code per pending row and owner activity (`isActive`, `lastSeenAt`). Recorded before PR-B and PR-C | A (re-run before B and C) |
| AC-INERT | After PR-A, the approve route's behaviour is unchanged for every existing envelope | A |
| AC-NOPARK | An approved converted envelope is allowed, not re-parked or re-minted | A |
| AC-DISPATCH | The approve route checks for the marker before `runApprovedExternalRequest`'s TaskRun branch. A TaskRun-bound converted envelope runs through the platform runner, not the external-task resume | A |
| AC-RERAISE | Ask again on a converted envelope, then Authorize, runs the call exactly once with the marker's source | A |
| AC-TRANSPORT | MCP transports cannot set `approvalCompletion`, `proposeBoundary` or `chatMessageId` | A |
| AC-STRAND | Owned by `BI-5B34D277`: one gate test per post-reservation exit (`mcp-governed-execute.ts:496-526`, `:536-548`, `:586-603`, `:606-632`) finalises the envelope `failed` with the refusal as its outcome | dependency of B and C |
| AC-RAISE | S1 (chat) and S2 mint an envelope whose fingerprint equals the call's binding fingerprint, and create zero proposal rows | B |
| AC-RUN | Authorizing runs the exact call once. A second approve or a replay returns `settled`. A mismatched argument fingerprint returns `not-run`. `approval_outcome` is recorded once | A (runner), B (wired) |
| AC-BOUNDARY | A propose-boundary call never executes before approval and never pauses its TaskRun on either pause site, including the forced-fallback collision. `policyProjectionAllowed` is false | B |
| AC-LEAVE | Leave approve and reject behave as characterised (after `BI-4E192035`). The recommendation reads through `decisionInteractionId`. Guard-only items render. The manager decision resolves the DecisionInteraction. No envelope is minted. Needs-you is deduplicated by `requestId` | B |
| AC-LEGACY | Legacy approve produces the characterised handler-visible tool, arguments, user and `{ agentId, threadId }`, and the characterised row end state, through the monitor, covering all four gate outcomes. A double approve is refused by the compare-and-set. Reject is unchanged | C |
| AC-RATCHET-ZERO | No dynamic site. Neither file listed | C |
| AC-UX | Chat inline card. Scheduled propose-boundary card. A legacy approve from Needs-you. The leave page. The operations-map confirm | B, C |

## 7. Research and benchmarking

| System | What it does | Adopt | Reject |
|---|---|---|---|
| **GitHub Actions environments**, required reviewers and deployment protection: https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/managing-environments-for-deployment and https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/reviewing-deployments | A job targeting a protected environment pauses. A reviewer approves that pending run, and it continues. An unapproved wait fails visibly. A "Prevent self-reviews" option exists | One approval object bound to one pending execution that it resumes (D1, D3). A visible lapse (BI-0012E6CA) | Self-review prevention as the default, because a DPF envelope lends the approver's own authority. Maker-checker is founder question Q1 |
| **ServiceNow approvals** (`sysapproval_approver`, Flow Designer "Ask for Approval"): https://www.servicenow.com/docs/bundle/xanadu-build-workflows/page/administer/flow-designer/reference/ask-for-approval-flow-designer.html | One approval table serves many record types. The record's own workflow acts on the verdict | One approval store for coworker actions (OBJ-CONVERGE). Non-coworker decisions (leave) stay with their own record and workflow (D2 S5) | A rule-based multi-approver engine ("absorb, don't adopt") |
| **Temporal signals** (https://docs.temporal.io/encyclopedia/workflow-message-passing) and **Airflow HITL operators** (https://airflow.apache.org/docs/apache-airflow-providers-standard/stable/operators/hitl.html) | Durable wait on a human signal, or a deferral with a timeout and a default. The decision resumes the exact step | Resume the exact paused call. Execution is idempotent through the compare-and-set and the `settled` replay | Adopting a workflow engine |

**Standard:** NIST SP 800-53 Rev. 5 AC-3 and AC-6 (https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final). An approval never widens authority (D4).

The URLs above are the vendor pages as named. The `record_initiative_evidence` research record should attach them as retrieved on the day.

## 8. Risks

| Risk | Mitigation |
|---|---|
| A stranded approval after a post-reservation refusal | `BI-5B34D277` is a hard dependency of PR-B and PR-C |
| A request refused at raise time (grants or identity) | The A2 probe measures it; waiver W2; the refusal is visible as `authority_denied` |
| Overnight outward requests lapse after 15 minutes; long waits lapse after 7 days | Waivers W1 and W4; Expired unanswered and Ask again |
| Approver narrowing: the second owner's 10 pending rows, and any future rows from their tasks | Waiver W6. Legacy rows keep today's rule (the approver acts) |
| A parked TaskRun flipped to working (`TASK_RUN_WORKING_ENTRY_STATES` include `input-required`, `lib/observability/heartbeat.ts:58-66`) | Propose-boundary envelopes neither pause nor resume (D2 S2) |
| Source-keyed hooks differ on the approved run | The marker's source is replayed (D3); AC-RERAISE |
| Reverting PR-B or PR-C with envelopes in flight | B and C are mutually independent and each revert alone. PR-A's runner and honour path keep in-flight envelopes valid. Revert A last |

## 9. Documentation impact

- **`docs/architecture/gated-permissions-process.md`:** update lines 609 and 630, and add version row **0.18** (the current one is 0.17, line 813) at the PR-C merge.
- **`docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md`:** tick line 850.
- **`apps/web/lib/gpp/unmediated-execute-sites.ts`:** update the header comment (lines 77-81).
- **User guide:**
  - `docs/user-guide/getting-started/ai-coworker.md`, lines 59 and 140: Authorize/Decline, inline and in Needs-you, with expiry and Ask again;
  - `docs/user-guide/ai-workforce/index.md:103`: Action History lists both;
  - the operations-map confirm.
- **Principle page `docs/founder-kernel/wiki/principles/escalation-is-a-gate-not-a-trust-tier.md`:** add the propose-boundary rule line, which the guard `lib/govern/authority/escalation-gate.conformance.test.ts:187-190` requires verbatim. Also fix the stale comment at `escalation-gate.ts:240`, which names a non-existent `check-escalation-gate.ts`. Editing a kernel principle needs WWMD/founder sign-off (Q2).
- **`docs/superpowers/specs/2026-09-01-approval-cards-recommendation-versus-authorization-design.md`:** add an "As built" note about the chat inline card.
- **`apps/web/lib/ea/route-manifest.json`:** regenerate if a route changes shape.

## 10. Constraint exceptions requiring founder waiver

PR-B and PR-C are merge-blocked until each item below has a recorded founder answer.

| # | What stops working that works today | Live evidence | Recommendation |
|---|---|---|---|
| **W1** | A new **outward** request (for example the weekly `run_hive_scout_ingest`) can wait for a decision only 15 minutes, not indefinitely. After that it shows Expired unanswered, and Ask again re-raises it for 7 days | 19 pending scout-ingest rows, the oldest from 2026-08-21 | Accept: one consequence taxonomy. Separately, review whether scout ingest is really outward; it ingests catalogues |
| **W2** | A proposal for a tool the coworker is **not granted** (or whose identity or GAID cannot be resolved) runs on approval today, because `approveProposal` checks only the human. After convergence a new one is refused when raised. A legacy one shows "can no longer run as proposed", with Decline only | Count per row from the A2 probe, recorded before PR-B and PR-C. The 19 outward scout-ingest rows also need GAID principal resolution for their receipt | Accept: this is the TAK intersection. An approval should not widen authority |
| **W3** | The **`X-Ops-Token`** shared-secret recovery on `execute-proposal`, which impersonates a user with a synthetic role, is removed. A superuser session still works | `HIVE_OPS_TOKEN` is unset on the live install | Accept |
| **W4** | A **non-outward** request can wait 7 days, then 7 more through Ask again. Proposals wait indefinitely | 35 of the 46 pending rows are older than 7 days. One `run_discovery_triage` has waited since 2026-08-31 (37 days), and a scout ingest since 2026-08-21. Legacy rows are unaffected, because convert-and-run approves on the spot | Accept 7 days plus Ask again (the paused-work-is-not-abandoned-work default) |
| **W5** | A request whose arguments **cannot be proven** later is refused under a propose boundary (secret-bearing `writeOnly` tools), or comes back `not-run` on approval (strings over 64 KB, or parameters dropped by a metrics-only audit class). Today the proposal stores the raw arguments, including secrets, and runs them | Today only `configure_and_test_discovery_connection` declares `writeOnly`. The A2 inventory asserts there is no metrics-only proposal-reachable tool | Accept refusal over plaintext secret storage |
| **W6** | **Who may approve.** Any signed-in user with the tool's capability can approve a proposal today. A new envelope can be approved only by the person whose authority is lent (for a scheduled task, its owner) | 10 of the 46 pending rows belong to the second owner, while all 25 executions were made by the first owner. The second owner is active (last seen 2026-10-07). The probe reports inactive or never-signed-in owners | Accept for new requests. Legacy rows keep today's rule through convert-and-run (the clicking approver acts) |

**Other founder questions (not constraint exceptions):**
- **Q1.** Do activity-routing overrides need a second-person (maker-checker) check? Recommendation: no.
- **Q2.** Sign-off for the propose-boundary line on the kernel principle page.

**Recorded answers (2026-10-07).** Per *consult-scopes-before-asking*, each item went to its owning scope first. A person is asked only where that scope left the call open:

| Item | Owning scope | Answer | Ledger |
|---|---|---|---|
| W1, W4 | WWMD (platform) | Accept: one lifetime rule across every approval surface | DI-63CCA242F626, high confidence, followed |
| W2, W5 | WWMD (platform) | Accept: enforce grants at raise and run; refuse plaintext-secret and unprovable requests | DI-A7B848DB59BC, high confidence, followed |
| W3, Q1 | WWMD (platform) | Accept W3 (remove the ops-token path); Q1: no second approver | DI-587137D2BB72, high confidence, followed |
| W6 | WWWD (the operating organisation), escalated to the founder | **Answered, with a change.** The person whose authority is lent (for a scheduled task, its owner) is the primary approver. An admin can still **override** and decide in their place, for example when that person has left or their sign-in doesn't work. An override records the overriding admin, the named owner and a reason, and the card says it was decided on someone else's behalf. The founder also observed that on this install most work runs under the shared admin account, which makes the owner and the admin the same principal (FU-9) | DI-4A1553CA4E27 escalated; founder answer 2026-10-07 |
| Q2 | Founder (kernel doctrine edit) | **Approved:** add the propose-boundary line to the principle page | founder answer 2026-10-07 |

Every waiver and question now has a recorded answer. **AC-OVERRIDE** (PR-B, plan B8): a non-delegate admin can approve or decline with a reason. The record and the card name the admin, the owner and the reason. A non-admin non-delegate is still refused, and the delegate path is unchanged. The W6 admin override is in scope for PR-B (raise and approve) and PR-C (legacy rows keep today's rule anyway).

## 11. Contradictions found (code against item and docs): 10

1. The item says 36 pending, newest 2026-09-30. Live: **46**, newest **2026-10-07**, all from S2.
2. The item lists field dispatch as a creation site. It has no production caller, and its tool does not exist (`mcp-tools.ts:604`).
3. `approveProposal` approves the leave whatever the recommendation (`proposals.ts:39-44`). Filed as `BI-4E192035`.
4. `approvalPendingResult` promises the approved call "runs once" (`approval-pending-result.ts:51`), but platform-origin envelopes never run (`approved-request-run.ts:91`). FU-1.
5. The v1 approvals route records `approve` without executing (`route.ts:79-94`). FU-2.
6. `autoApproveWhen` (`agentic-loop.ts:2304-2337`) is overridden for coworker calls by escalation branch 1, contrary to the `execute-proposal` header (`route.ts:7-11`). FU-3.
7. PR-H calls for a service principal for the ops-token path. This design removes the path instead (W3).
8. The item's drain plan cannot be made true on every install. Replaced by D5.
9. `AgentActionProposal.status` is a free-form string that holds `approve`/`reject`, contrary to AGENTS.md §8. It is legacy, so this design records it and does not widen it.
10. Propose-interception diverts before the monitor, so `scheduled-mandate` steering never applies to propose-boundary runs. Kept tighten-only. FU-4.

Gap 2 (§4), the stranded approval, is a defect, not a contradiction. It is filed as `BI-5B34D277`.

## 12. Follow-ups (to file; not filed by this spec)

- **FU-1:** run on approval for every platform-origin envelope.
- **FU-2:** the v1 approvals route.
- **FU-3:** `autoApproveWhen` versus escalation branch 1.
- **FU-4:** propose boundary versus scheduled mandate.
- **FU-5:** `AgentActionProposal` table retirement.
- **FU-6:** dead `propose_file_change` stamping (`build-ops-pack.ts:398`).
- **FU-7:** autonomous loop callers silently drop proposal-mode calls (`autonomous-work-run.ts:589`).
- **FU-8:** leave and proposal Needs-you items are visible to every operator (`agent-proposal.ts:109`).
- **FU-9:** most work on this install runs under the shared admin account, so "the person whose authority is lent" and "an admin" are often the same principal. Owner-scoped approval only means something once people work under their own sign-ins. Track nudging operators off the shared admin account (per-person sign-in, and showing who acted) as a separate item.
