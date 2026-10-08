---
status: active
---

# Plan: Converge Human Approval on CoworkerActionEnvelope (BI-C8EC05C9)

- Date: 2026-10-07 (revised after independent review)
- Spec: `docs/superpowers/specs/2026-10-07-approval-convergence-on-envelope-design.md`. It holds decisions D1–D9, waivers W1–W6, questions Q1–Q2, acceptance IDs and follow-ups FU-1 to FU-8.
- Backlog coverage: every deliverable maps to `BI-C8EC05C9` (parent `BI-69415B68`).
- Dependencies, filed separately:
  - `BI-5B34D277` (stranded reserved approval) must be merged before PR-B and PR-C.
  - `BI-4E192035` (leave approve-regardless) must be merged before PR-C.
- Shape: `delivery-large@1.0.0`. **Three PRs.** PR-A is the base. PR-B and PR-C are mutually independent, and each can be reverted alone. Revert A last.

> **For agentic workers.** Use one branch and one PR per phase, cut from fresh `origin/main` in the dedicated sibling worktree base. Follow `dpf-tdd`. Characterisation is the first commit and must be green on the base before any production edit. The fast local gate is `pnpm --filter web exec vitest run <affected>`, then `pnpm --filter web typecheck`. The heavy build runs in the merge queue. A gate that could not run is inconclusive, never passed.

## Merge gates

| PR | Must be true before merge |
|---|---|
| A | None beyond the build gate. PR-A changes no behaviour (AC-INERT). |
| B | (1) `BI-5B34D277` is merged. (2) W6 has a recorded founder answer. W1, W2, W4, W5 and Q1 are answered by WWMD; see spec §10 "Recorded answers". Q2 gates only the principle-page line in PR-A. (3) The A2 probe has been re-run and attached as workroom evidence. |
| C | (1) `BI-5B34D277` and `BI-4E192035` are merged. (2) W6 has a recorded founder answer. W2 and W3 are answered by WWMD; see spec §10. (3) The A2 probe has been re-run, and every live pending row either is admissible or has a recorded waiver disposition. |

## Why three PRs

| PR | Contents | Behaviour change |
|---|---|---|
| **PR-A** | Characterisation, inventory and probe, plus inert substrate | None for any existing row or flow |
| **PR-B** | New requests raise envelopes: S1 (chat) and S2. Leave reads and resolves through its DecisionInteraction (S5). S3 becomes a direct confirm. S4 is removed | Yes, for new requests only (the named deltas below) |
| **PR-C** | Legacy approvals run convert-and-run through the monitor. Both direct sites leave the ratchet. The ops-token branch is removed | Yes, for the legacy execution path. The outcome is the same and the execution is now mediated |

Characterisation shares PR-A with the inert substrate because neither changes behaviour. Characterisation is the first commit. PR-B and PR-C stay separate so that either can be reverted without reopening the other.

---

## PR-A: characterise, inventory, inert substrate

Branch `feat/approval-convergence-substrate`. Acceptance: AC-CHAR, AC-INVENTORY, AC-PROBE, AC-INERT, AC-NOPARK, AC-DISPATCH, AC-RERAISE, AC-TRANSPORT, and AC-RUN at the runner level.

### A1. Characterisation (first commit, tests only)

| Suite | Pins | File |
|---|---|---|
| S1, chat | A proposal-mode tool returns `agenticResult.proposal` before `governedExecuteTool`. An `autoApproveWhen` that is true falls through to the gate. `agent-coworker.ts:1974-2003` writes the message and the `AP-` proposal | new `lib/tak/agentic-loop.proposal-mode.characterization.test.ts` |
| S1, autonomous callers | For each caller of the loop, a proposal-mode call ends the loop and nothing is persisted. Callers: `agent-task-scheduler.ts`, `agent-thread-dispatcher-runtime.ts:295`, `mcp-task-execution.ts:218`, and `autonomous-work-run.ts:526` (build orchestration, coding agent, certification-runner via its callers). PR-B must leave these unchanged | same file, one case per caller |
| S2 | The divert predicate. The synthetic result text. The "Proposed `X`…" assistant message. The proposal row shape. Fail-closed on a persistence error. The scheduler's playbook `partial`/`completed` verdict (`agent-task-scheduler.ts:634-647`) and `detectScheduledRunFailure` (`:627-628`) for a diverted call. The forced fallback (`:598-617`) after a diverted required tool | `lib/proactivity/propose-interception.test.ts`; new `lib/actions/agent-task-scheduler.propose.characterization.test.ts` |
| S3 | The proposal under the synthetic agent. Approve → `executeTool` → no-op handler → `executed`. Readers `routed-inference.ts:286` and `load-map-data.ts:534` read `approve\|approved\|executed` | `lib/actions/activity-harness-routing.test.ts` plus reader tests |
| S4 | The proposal is created. Approve returns "Unknown tool" and the row goes to `failed` | `lib/proactivity/field-dispatch-runtime.server.test.ts` |
| S5 | `proposeLeaveDecision` idempotency, its transaction and the assistant message. `approveLeaveRequest` and `rejectLeaveRequest`: authority-first ordering, balance, status, audit, settle. The guard-only path (`interactionId: null`). The `leave-data.ts` projection. The `approveProposal(leave.decide)` mapping as it stands on base. When `BI-4E192035` lands, it updates this case to its fixed behaviour, and PR-C characterises against that | `lib/workforce/leave/decide-proposal.test.ts`, `lib/actions/leave.test.ts` |
| Proactivity change | Approve persists the fact and sets `executed`. Reject persists a 7-day cooldown. The v1 equivalents | `lib/proactivity/proactivity-change-proposal.test.ts`, `lib/api/__tests__/governance-endpoints.test.ts` |
| v1 approvals | The route writes `approve`/`reject` and does not execute | `lib/api/__tests__/governance-endpoints.test.ts` |
| Readers | `command-center.ts:400` count. `agent-card-service.ts:308` latest pending. Action History | existing reader tests |
| Direct sites | Already covered by PR-H (`proposals.characterization.test.ts:50,68,77`; `route.characterization.test.ts:56,70,87,97`). Add assertions for the `{ agentId, threadId }` context, the system message and the decision log | as named |

### A2. Inventory and probe

- **`lib/coworker/approval-convergence-inventory.test.ts`** runs against the live registry. For every proposal-reachable tool (proposal-mode, plus side-effecting non-artifact tools reachable under a propose boundary) it asserts:
  - consequence → window, as in the spec's D7 table;
  - the `writeOnly` list, expected to be `configure_and_test_discovery_connection` only;
  - `auditClass !== "metrics_only"` or `retainAuditParameters === true`, using `lib/tool-audit-helpers.ts:4-13`;
  - the intersection with `PROJECTABLE_ACTIONS` is empty.
- **`scripts/approval-convergence-probe.ts`** is read-only and is run by the agent, not by CI. For each live pending proposal it dry-runs the real `resolveCoworkerToolAuthorityInput` and `evaluateCoworkerAuthority`, plus:
  - GAID principal resolution for the receipt (needed by the 19 outward scout-ingest rows);
  - pre-tool hook verdicts;
  - `alignmentRequired`.

  It does this under the context that convert-and-run will use: `{ agentId, threadId }`, with the approver as the thread owner. It reports one refusal code per row, plus owner `isActive` and `lastSeenAt`. Record the output as workroom evidence. It feeds W2 and W6.

### A3. Inert substrate (second commit onward)

| Change | File(s) | Why inert |
|---|---|---|
| Escalation branch `propose-boundary` placed after branch 1, with its reason sentence and its `describeEscalationRule` line. The principle page line is added in the same commit, so the conformance guard (`escalation-gate.conformance.test.ts:187-190`) stays green; sign-off is Q2. Fix the stale comment at `escalation-gate.ts:240` | `lib/govern/authority/escalation-gate.ts`, its unit and conformance tests, `docs/founder-kernel/wiki/principles/escalation-is-a-gate-not-a-trust-tier.md` | Nothing sets `proposeBoundary` yet |
| Server-only context fields: `proposeBoundary`, `approvalCompletion: "platform"`, `chatMessageId`. The resolver maps `proposeBoundary` into the escalation input and sets `policyProjectionAllowed: false` (`resolve-coworker-tool-authority.ts:451`) | `lib/mcp-governed-execute-types.ts`, `lib/govern/authority/resolve-coworker-tool-authority.ts` | No caller sets them |
| Envelope metadata `argsJson.proposeBoundary` and the `chatMessageId` column. Both pause sites (`authority-approval-envelope.ts:162` and `:202`) skip the pause when the active envelope carries the flag. The gate skips `resumeApprovedTask` for such an envelope | `lib/coworker/authority-approval-envelope.ts`, `lib/govern/authority/coworker-tool-authority-gate.ts` | The flag is never set yet |
| The `_approvalResume` marker: source, both baselines, `proposeBoundary`, `workroomId`, `featureBuildId`, and the external-access inputs. It is written only when `approvalCompletion === "platform"`, and its key is added to `GOVERNED_AUDIT_PARAMETER_KEYS` | `lib/governed-tool-audit.ts`, `lib/attention/coworker-envelope-decision.ts` | No caller sets it |
| `runApprovedPlatformRequest`, per spec D3, returning `{ status, message, entityId }`. The approve route checks for the marker **before** `runApprovedExternalRequest`, and records `approval_outcome` once | `lib/coworker/approved-request-run.ts`, `app/api/agent/envelope/[envelopeId]/approve/route.ts` | No row has the marker |
| Dual-read helpers: activity-routing overrides (UserFact ∪ successful legacy proposals); leave recommendation (DecisionInteraction, then guard evaluation, then legacy proposal); Action History; `command-center.ts:400`; `agent-card-service.ts:308` | `lib/routing/activity-harness-approval-source.ts`, `lib/inference/routed-inference.ts`, `lib/ai-operations-map/load-map-data.ts`, `lib/workforce/leave-data.ts`, `lib/evaluate/proposal-data.ts`, `lib/workspace-home/command-center.ts`, `lib/tak/agent-card-service.ts` | The new sources are empty, so the output is identical (asserted) |
| Inline card: `serializeMessage` (`lib/tak/agent-coworker-data.ts:29`) attaches the **list** of envelopes for the message's `chatMessageId`. `AgentMessageBubble` renders each one with the shared Authorize/Decline surface, using only `--dpf-*` tokens | `lib/tak/agent-coworker-data.ts`, `components/agent/AgentMessageBubble.tsx`, a piece extracted from `components/attention/CoworkerEnvelopeApproval.tsx` | No envelope has `chatMessageId` yet |

**Tests (red first):**
- **Runner.** Run-once with a system message and `entityId`. A second call returns `settled`. Fingerprint mismatch returns `arguments-not-provable`. Expired returns `expired`. No marker falls through unchanged.
- **AC-DISPATCH.** A marker-bearing envelope with a `taskRunId` reaches the platform runner, not the external-task branch (`approved-request-run.ts:86-88`).
- **AC-RERAISE.** Ask again on a converted envelope rewrites the row's `executionMode` to `"proposal"` (`envelope-reraise.ts:238-243`). Then Authorize runs once, with the marker's source.
- **AC-NOPARK.** The gate allows an approved envelope for an identical binding, with no new mint.
- **Propose-boundary.** The branch order is pinned in the conformance walk. Neither pause site changes the TaskRun, including the reuse-path collision. `policyProjectionAllowed` is false.
- **AC-TRANSPORT.** `/api/mcp/v1` and `/api/mcp/call` cannot set the three context fields.
- **Dual-read parity** on the A1 fixtures.

**Verification.** Affected vitest suites, typecheck, lint. UX: none owed, because nothing is user-visible; the card has a render test. Docs: the principle page line and the comment fix.

---

## PR-B: new requests raise envelopes

Branch `feat/approval-convergence-raise`. Acceptance: AC-RAISE, AC-RUN (wired), AC-BOUNDARY, AC-LEAVE, and AC-UX (B items). It is merge-blocked per the gate table above.

| Task | Change | Files |
|---|---|---|
| B1 (S1) | **Chat only** (`interactionMode === "chat"`). Autonomous callers keep the A1-pinned behaviour (FU-7). Remove the pre-monitor return. Set `approvalCompletion` and `chatMessageId`. `approval_required` with reason `declared-proposal` ends the turn with `pendingApproval: { envelopeIds }`. `settled` renders the recorded outcome. `agent-coworker.ts` stops creating proposals. The panel's Authorize handler uses the runner's `entityId` for the follow-up, keeping today's "Result: <id>" text | `lib/tak/agentic-loop.ts`, `lib/actions/agent-coworker.ts`, `components/agent/AgentCoworkerPanel.tsx` |
| B2 (S2) | `interceptToolCallAsProposal` calls `governedExecuteTool` with `proposeBoundary` and `approvalCompletion`, and returns according to the gate outcome. `approval_required` gives the synthetic success with `envelopeId`, its expiry, and the Ask-again sentence. `allow` returns the real result, because the tool ran on an existing approval. `settled` returns the recorded result. A refusal returns a not-run `success: false`. Tools with `writeOnly` inputs are refused under the boundary (W5). Keep the "Proposed `X`…" assistant message. Delete the proposal persistence port | `lib/proactivity/propose-interception.ts`, `lib/tak/agentic-loop.ts` |
| B3 (S3) | The operations-map confirm calls a server action that runs `governedExecuteTool` (no agent, `source: "rest"`). On success it persists the `UserFact` override (category `activity-routing-override`, the `persistProactivityFact` pattern). This replaces `proposeActivityHarnessOverrideAction` | `lib/actions/activity-harness-routing.ts`, `components/platform/ActivityRoutingWorkbench.tsx` |
| B4 (S4) | Delete `proposeUserAwareFieldDispatchNotifications` and its test. Keep `field-dispatch-runtime.ts` | `lib/proactivity/field-dispatch-runtime.server.ts` |
| B5 (S5) | `proposeLeaveDecision` writes the assistant message and the `decisionInteractionId` link, but no proposal. `approveLeaveRequest` and `rejectLeaveRequest` call `recordDecisionOutcome` (`lib/decision/decision-outcome-store.ts:109`) on the request's `decisionInteractionId` when one exists. `settleLeaveDecisionProposal` stays for legacy rows. The Needs-you leave item moves to `business-approvals`, deduplicated by `requestId`. Its audience is unchanged, and the leak is recorded as FU-8 | `lib/workforce/leave/decide-proposal.ts`, `lib/actions/leave.ts`, `lib/attention/sources/business-approvals.ts`, `lib/attention/sources/agent-proposal.ts` |
| B6 | Source guard: any non-test call to `agentActionProposal.create` fails | `lib/coworker/no-new-proposals.test.ts` |
| B7 | Docs: user guide `getting-started/ai-coworker.md` (lines 59 and 140) and `ai-workforce/index.md:103`; the operations-map copy; the approval-cards spec "As built" note | as named |

**Named characterisation deltas (only these):**
- **S1, chat:** the proposal row becomes an envelope (or a list of envelopes).
- **S2:** the proposal row becomes an envelope. The result carries `envelopeId` and expiry wording. A refusal produces `success: false`, which now counts toward the playbook's `partial` verdict.
- **S3:** the two-step flow becomes a confirm plus a UserFact.
- **S4:** removed.
- **S5:** the proposal row is gone. The recommendation is read through the DecisionInteraction. Guard-only reasons are evaluated at read time. The manager's decision resolves the DecisionInteraction.

Every other A1 case, including all autonomous callers, the scheduler's forced fallback and failure detection, stays green and unchanged.

**Verification.**
- Unit tests, typecheck, lint, merge-queue build.
- UX on the canonical runtime after merge, via `/ops/self-upgrade`, using a seeded persona at its real privilege:
  1. In chat, request `contribute_to_hive`. Expect an inline card and a Needs-you card. Authorize it. Expect one run, a follow-up that carries the result id, and "already decided" on a repeat Authorize.
  2. Run a propose-boundary scheduled task now (for example the discovery triage cadence). Expect the run to complete as characterised, the TaskRun not to sit in `input-required`, and a Needs-you card. Authorize it. Expect it to run and the system result to appear in the thread.
  3. Use an outward fixture. Expect Expired unanswered and a working Ask again.
  4. Open the time-off page. Expect the recommendation, including a guard-only one, to show. The manager approves and rejects. Expect the DecisionInteraction to be resolved and a single Needs-you item per request.
  5. Confirm an override on the operations map. Expect routing to reflect it, and an override approved before the change to still apply.

---

## PR-C: legacy approvals through the monitor; both direct sites retire

Branch `feat/approval-convergence-legacy`. Acceptance: AC-LEGACY, AC-RATCHET-ZERO, and AC-UX (C items). It is merge-blocked per the gate table above.

| Task | Change | Files |
|---|---|---|
| C1 | Implement convert-and-run exactly as spec D5. First, a compare-and-set on the proposal row (`updateMany` where `status: "proposed"`). Then `governedExecuteTool` with context exactly `{ agentId, threadId }` (as `proposals.ts:64` does today), `taskRunId` and `routeContext` null, the approver as user, `source: "rest"`, and `approvalCompletion: "platform"`. There is no forced escalation. Handle the gate outcomes: **allow** means the tool already ran; **approval_required** means `approveEnvelope(id, approver)` followed by `runApprovedPlatformRequest`; **settled** means use the recorded status; a **refusal** means compare-and-set the row back to `proposed` and return the reason. Map results to the characterised row end state, system message and `AuthorizationDecisionLog`. Record `approval_outcome` once | `lib/actions/proposals.ts` (core extracted to `lib/actions/proposal-convert-and-run.ts`) |
| C2 | `execute-proposal` keeps **its own response shape** (`{ ok, result }`) and status codes, and calls only the shared convert-and-run core. It adds no system message or decision log of its own beyond what the core writes. Delete the `X-Ops-Token` branch (W3) and `HIVE_OPS_TOKEN` from `docker-compose.yml:335`. Update `scripts/endpoint-classification-baseline.txt` and `scripts/route-error-baseline.txt` if their counts change | `app/api/admin/ops/execute-proposal/route.ts`, `docker-compose.yml` |
| C3 | Legacy card: a monitor refusal shows "This request can no longer run as proposed: …", with Decline only | `components/attention/CoworkerProposalActions.tsx`, `components/agent/AgentCoworkerPanel.tsx` |
| C4 | Remove both files from `KNOWN_UNMEDIATED_EXECUTE_SITES` and update its header. The ratchet expects zero dynamic sites | `lib/gpp/unmediated-execute-sites.ts`, `lib/gpp/unmediated-reach-ratchet.test.ts` |
| C5 | Add `proposals.governed.test.ts` and `route.governed.test.ts`, which drive the real monitor and cover all four gate outcomes and the double-approve compare-and-set (the PR-H method). The A1 cases pass unchanged, with one named delta: the route's ops-token case (`route.characterization.test.ts:70-86`) is replaced by "an `X-Ops-Token` request without a session gets 401" | as named |
| C6 | Docs: `gated-permissions-process.md` lines 609 and 630, and version row **0.18**; the GPP phase-2 plan line 850; `route-manifest.json` if needed | as named |

**Verification.**
- Unit tests (A1 unchanged except the named delta; C5 new), typecheck, lint, merge-queue build.
- `binding-enforcement.test.ts` still passes with an empty enforcement table.
- A fixture test that `promotionRefusals` no longer lists any dynamic-site refusal.
- UX on the canonical runtime after merge:
  1. From Needs-you, approve one live legacy row that the probe marked admissible. Expect one run, the row at `executed`, and an envelope plus an audit row.
  2. Double-click Approve. Expect a single run.
  3. Decline another row. Expect `rejected`.
  4. Approve a row the probe marked refused, if any. Expect the reason to show and the row to stay `proposed`.
  5. As superuser, call `execute-proposal` with a session. Expect it to work with today's response shape. Call it with `X-Ops-Token` only. Expect 401.

---

## Coverage map

| Deliverable (item body) | Spec | PR | Backlog |
|---|---|---|---|
| 1. Each creation site raises a bound envelope, and the UI moves to it | D1, D2 | B (substrate in A) | BI-C8EC05C9 |
| 2. Approved envelopes execute via `governedExecuteTool` | D3, D4 | A (runner), B (wired); depends on BI-5B34D277 | BI-C8EC05C9, BI-5B34D277 |
| 3. Legacy proposals keep their outcome, and the direct sites leave the list and are deleted | D5, D6 | C; depends on BI-5B34D277 and BI-4E192035 | BI-C8EC05C9, BI-4E192035 |
| 4. Founder constraints: characterise first; waivers recorded | Constraints, §10 | A first; merge gates on B and C | BI-C8EC05C9 |
| Data and retirement, non-destructive | D8 | A–C | BI-C8EC05C9; FU-5 |

## Completion

After PR-C is merged and verified on the live install:
1. Record execution evidence, and canonical-runtime evidence for AC-UX.
2. Reconcile OBJ-CONVERGE, OBJ-MEDIATION, OBJ-NODISRUPT and OBJ-HISTORY with `record_product_outcome_observation`.
3. Update the `BI-C8EC05C9` status.
4. File FU-1 to FU-8.
