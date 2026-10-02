---
status: active
---

# Approval cards distinguish AI recommendation from human authorization

- Backlog: `BI-F95B0795`
- Epic: `EP-31815F97`
- Workroom: `WC-B809341F`
- Profile: fix — this document is the research record and the ordered fix sequence

## Problem

The live `Needs you` card for a governed initiative-research receipt asks “Approve this coworker action?” and leads with TaskRun, agent, repository, commit, path, blob, status, and expiry. It does not tell the authorizing person the proposed decision or its effect. It also uses “approval” for two different acts: the coworker’s judgment and the employee’s authority to persist that judgment.

## Research — defect on a named ref

Confirmed on `origin/main` `91f50bcc65eacc3f9518a16d5302eda9d591bda5`.

| Cause candidate | How it was ruled out |
| --- | --- |
| Envelope never reaches the inbox | Ruled out by running the colocated projector tests: `coworker-envelope.ts` already projects `coworker-envelope` items into `needs-you-now`. |
| Cross-identity invisibility | Ruled out as a different defect: `BI-06AE037F` / PR #4908 names the approval owner and location. This item is about a *visible* envelope that is unintelligible. |
| Proposed arguments missing from the database | Ruled out: `ToolExecution.parameters` stores `{ decision: "pass" }` on the `approval_required` audit row (`mcp-governed-execute.ts` writes that audit). `CoworkerActionEnvelope.argsJson` deliberately stores only `{ approvalBinding }` (`authority-approval-envelope.ts:116-119`). |
| Owner card has no AI-recommendation slot | Ruled out: `OwnerDecisionCard.recommendation.lead` is already `"AI recommendation"`. The text is a generic “check the exact record and the time left”. |

Actual cause, cited on that ref:

- `apps/web/lib/attention/sources/coworker-envelope.ts` does not load `ToolExecution.parameters` or `argsJson`.
- `apps/web/lib/attention/owner-decision-copy.ts:26` hard-codes `"Approve this coworker action?"`.
- `apps/web/components/attention/CoworkerEnvelopeApproval.tsx:73-95` puts coworker, action, TaskRun, commit, path, and blob in the primary surface.
- Colocated tests require that plumbing to be visible, so the defect is locked in.

The bound handler (`initiative-readiness-pack.ts`) fills `gate`, `itemId`, `artifactRef`, empty `findings`, and reviewer `reason` for research receipts. The card must project that recorded effect, not invent a friendlier one.

## Research & benchmarking

Compared three HITL leaders for the owner-copy contract only:

| Product | Adopt | Reject |
| --- | --- | --- |
| GitHub pull-request review | The primary surface states the proposed change and the reviewer’s verdict; SHAs and blob ids stay in the diff header / commits tab. | Do not copy GitHub’s “Approve” for the second act — DPF’s second act is authorization to *record* a receipt. |
| Linear issue triage | Decision-first headline; identifiers live in a details drawer. | Do not add a second inbox. |
| Slack workflow approval | Separate “what will happen” copy from the confirm/deny controls. | Do not add a Slack-shaped modal. |

DPF already has the progressive-disclosure shell (`OwnerDecisionCards` + `Technical detail`). This fix reuses it.

## Design

1. Keep `CoworkerActionEnvelope.argsJson` as the approval-binding store. Do not start persisting raw tool arguments there.
2. Project the exact proposed call from the pending `ToolExecution.parameters` (same join `resumeApprovedRemoteTask` already uses: `taskRunId` + tool name + `result.data.envelopeId`). Fall back to `argsJson` minus `approvalBinding` for envelopes that do store action args (browser-drive).
3. A pure summarizer maps known `record_initiative_evidence` shapes (pass / fail / not-applicable, with or without findings) plus bound gate/subject semantics into owner copy. Unknown tool shapes fail closed to a truthful generic summary.
4. Owner copy labels the first act **AI recommendation** and the second **human authorization**. Buttons are **Authorize** and **Decline**, each with a one-line effect. Neither stage is called “approval”.
5. Agent id, TaskRun, repository, commit, blob, fingerprints, and routing metadata move under Technical detail.

Acceptance shape for the live research-pass receipt:

> AI recommendation: research passes with no findings. Human authorization needed: record that receipt so implementation planning may continue.

## Ordered fix sequence

1. Add `coworker-envelope-decision.ts` and tests for pass / fail / not-applicable, findings, unknown shapes, and recommendation-versus-authorization labels.
2. Load proposed parameters in `coworker-envelope.ts` and attach a `decision` summary to `AttentionEnvelopeApproval`.
3. Drive headline, situation, recommendation, and consequence from that summary.
4. Render decision-first facts and Authorize/Decline copy on `CoworkerEnvelopeApproval`; collapse identity plumbing into `technicalFields`.
5. Update colocated tests so they fail if plumbing returns to the primary surface.

## UX fit

- Owning area: Workspace inbox (`/workspace/inbox`).
- Persona: the employee who must authorize a coworker HITL envelope.
- Navigation layer: contextual action on an existing card. No new route.
- Reuse: `OwnerDecisionCards`, `ExpandableCard`, `StatusBadge`, existing envelope endpoints.
- Source truth: `CoworkerActionEnvelope` + pending `ToolExecution.parameters` + `TaskRun.a2aMetadata.initiativeReviewBinding`.
- AI boundary: Authorize/Decline remain explicit confirmation; they do not send a prompt.

## Documentation impact

This spec is the design/plan artifact. User-guide copy is unchanged: `/workspace/inbox` remains the Needs-you home. No migration.

## Verification

- Unit: summarizer + projector + card tests listed above.
- UX: drive a research-pass envelope on `/workspace/inbox` and confirm the primary card states the verdict and authorization effect before Technical detail is opened.

## Successor: handover approvals that cannot run, stall, or loop (BI-F4EB23C1)

- Backlog: `BI-F4EB23C1` (epic `EP-31815F97`). Workroom `WC-15D6C8CE`. TTL policy stays with `BI-0012E6CA`.
- Incident: `WC-D72FAD2A`. AGT-EXT-CODEX, connected as `admin@dpf.local`, asked to take the room over. Envelope `cmuqe2lxw0nvl01p719rvyzdb` was approved, then its run failed with `workroom_access_denied` (ToolExecution `cmuqe2pe80nw301p75dtuqpv0`). The identical replay minted `cmuqe3j2p0nyv01p7uthk59oo`. Earlier, `cmuqdae6p0bo001p73ets7zib` stayed grey and its row is still `proposed`.

### Research — defect on a named ref (`origin/main` 79f4b9492)

Live rows were read with a read-only SQL transaction, a stated direct-DB fallback because the room refuses MCP reads to this assistant.

- **The refusal is correct.** `admin@dpf.local` resolves to principal "admin", which created the room. "Mark Bodman" (`markdbodman@gmail.com`) is its only participant, as an active `coordinator`. `ownsRoom` (`workroom-agent-access.server.ts`) says a creator owns a room only when no other person oversees it. The existing test case "someone else oversees a legacy room" covers this exact situation. The approving account was never the owner, so the handover had to be refused.
- **Defect 1, the approval was asked for anyway.** `governedExecuteTool` runs the authority gate, which mints the envelope, before `callExecuteTool` checks room access (`mcp-governed-execute.ts:197`). A person is asked to authorize a call that is certain to be refused.
- **Defect 2, the refusal gives no reason.** `workroomTargetAccessRefusal` collapses "you are not the owner" and "this assistant was removed from the room" into "Ask its owner to invite you", even when the asking person is admitted to the room and is told nothing new.
- **Defect 3, a failed approval is invisible to replay.** `findExecutedAuthorityOutcome` (`authority-approval-envelope.ts:250`) matches only `executed`. A failed approval therefore mints a new card, although `approvalPendingResult` promises that "calling it again afterwards returns that recorded outcome".
- **Defect 4, the card can stay grey forever.** `CoworkerEnvelopeApproval.decide` awaits `fetch` with no timeout and never reconciles. A request that never answers leaves both buttons disabled with "Waiting for your decision".
- **Defect 5, the handover card is a wall of text.** `reassign_workroom_executor` falls to the generic `exact` summary. Its `handoffManifest` JSON, raw IDs, and the two effect sentences fill the primary block.
- Ruled out: credential or consent drift (the run reached the room check, which is after `verifyApprovalCredential`), a mismatched input fingerprint (same reason), and an id-shape mismatch between principal row id and `principalId` (holders store row ids, and the live rows match).

### Design

1. **Room access before approval.** For an OAuth call that targets a room, the same `workroomTargetAccessRefusal` runs before the authority gate. A refusal is audited and returned, and no envelope is minted. The check still runs again at execution, so nothing is relaxed.
2. **Handover refusals name their cause.** `resolveAgentWorkroomAccess` reports why a handover was refused, but only to a person who is admitted to the room: `not-owner` or `assistant-in-room`. The tool returns `workroom_handover_not_owner` or `workroom_handover_assistant_in_room`, each with a supported recovery: connect the assistant as the room owner's own account, or have the owner invite or re-admit the assistant. Nothing is revealed to a person outside the room. No access is granted by the message.
3. **A failed approval settles its replay.** Replay finds `executed` and `failed` envelopes for the same binding within the existing 15-minute window. A failed one returns `approval_outcome_failed` with the recorded error, and no new card. After the window, the coworker may ask again, which is a new, deliberate request. The pending-result copy says this.
4. **Bounded pending state on the card.** The decision POST is aborted after 30 seconds. The card then reads the envelope's recorded state from a new owner-only GET `/api/agent/envelope/:id`, which uses the same `loadApprovalOutcomes` projection as the Inbox. If the state is still `waiting`, nothing was saved and the buttons return, with that explained. Any other state is shown with its next step. If the state cannot be read, the card says the result is unknown, says not to approve again, and links to the Inbox result. Nothing is ever resubmitted automatically.
5. **Plain handover card.** A known handover reads as follows. Who takes over which room, and for which work. What the assistant can then do: act in that one room, on its branch, worktree and evidence. What it cannot do: other rooms, or widening its permissions. What Decline leaves unchanged. Authorize and Decline effects are separate lines. Tool name, IDs, the reason, the full arguments and the handoff manifest move into a collapsed Technical details block. Exact-content cards for other tools keep their content visible. Unknown shapes still fail closed.

### Ordered fix sequence

1. Red tests: pre-approval refusal, handover refusal causes, failed-outcome replay, card timeout and reconcile, handover summary.
2. Server: deliverables 1–3. 3. Status route and card: deliverables 4–5. 4. Gates, independent review, PR, merge queue, runtime check on the live install.

### Research & benchmarking

GitHub's protected-environment reviews and Argo CD's sync windows both check eligibility before asking a reviewer. A request that cannot run is refused up front rather than queued for approval. DPF adopts that ordering. Stripe's idempotency keys return the stored result, success or failure, for a replayed request within a window. DPF adopts this for failed approvals, where it previously did so only for successes. It rejects automatic client retries of the consequential POST, which Stripe permits only with a key that DPF's card does not hold.

### Verification

Unit tests for each deliverable. Production build. Runtime check after merge, on the live install: an OAuth replay of the incident's call by a non-owner returns `workroom_handover_not_owner` and mints no envelope.
