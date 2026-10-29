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

1. **Room access before approval.** For an OAuth call that targets a room, `workroomTargetAccessRefusal` runs before the authority gate. A refusal is audited and returned, and no envelope is minted. #5914 (BI-061D7192) landed this as `runGovernedToolPreflight` while this work was in flight, and this branch adopts it. The one exception is an approved run (`callerClient` `approval-completion`). It is room-checked after the gate, inside `callExecuteTool`, so a refusal closes its approval as `failed` instead of leaving it `approved`. Every path is checked exactly once.
2. **Handover refusals name their cause.** `resolveAgentWorkroomAccess` reports why a handover was refused, but only to a person who is admitted to the room: `not-owner` or `assistant-in-room`. The tool returns `workroom_handover_not_owner` or `workroom_handover_assistant_in_room`, each with a supported recovery: connect the assistant as the room owner's own account, or have the owner invite or re-admit the assistant. Nothing is revealed to a person outside the room. No access is granted by the message.
3. **A failed approval settles its replay.** Replay finds `executed` and `failed` envelopes for the same binding within the existing 15-minute window. A failed one returns `approval_outcome_failed` with the recorded error, and no new card. After the window, the coworker may ask again, which is a new, deliberate request. The pending-result copy says this.
   - *Amended by BI-5B34D277.* An approval the gate reserved is settled even when the call is refused before its tool runs. That covers a pre-tool hook, the alignment and precondition gates, permit enforcement, receipt reservation, an approved-task resume failure, and any exception. The refusal's disposition in `governed-rejection-disposition.ts` decides the outcome. A settled no (`refused`) closes the envelope as `failed`, and that refusal is the recorded outcome. Replay reports it as "refused before it ran", not "already ran". Every other disposition (`inconclusive`, `awaiting-input`, `awaiting-person`) releases the reservation with a compare-and-set on the run's own `resolvedAt`. Nothing ran, so the approval stands, and a retry spends it once. A run that loses the reservation returns the winner's recorded outcome, if the winner has one, before it reports "already used". Code: `lib/govern/authority/approval-reservation.ts`.
4. **Bounded pending state on the card.** The decision POST is aborted after 30 seconds. The card then reads the envelope's recorded state from a new owner-only GET `/api/agent/envelope/:id`, which uses the same `loadApprovalOutcomes` projection as the Inbox. If the state is still `waiting`, nothing was saved and the buttons return, with that explained. Any other state is shown with its next step. If the state cannot be read, the card says the result is unknown, says not to approve again, and links to the Inbox result. Nothing is ever resubmitted automatically.
5. **Plain handover card.** A known handover reads as follows. Who takes over which room, and for which work. What the assistant can then do: act in that one room, on its branch, worktree and evidence. What it cannot do: other rooms, or widening its permissions. What Decline leaves unchanged. Authorize and Decline effects are separate lines. Tool name, IDs, the reason, the full arguments and the handoff manifest move into a collapsed Technical details block. The original exact-content visibility rule is superseded by the progressive-disclosure amendment below. Unknown effects remain explicit.

### Ordered fix sequence

1. Red tests: pre-approval refusal, handover refusal causes, failed-outcome replay, card timeout and reconcile, handover summary.
2. Server: deliverables 1–3. 3. Status route and card: deliverables 4–5. 4. Gates, independent review, PR, merge queue, runtime check on the live install.

### Research & benchmarking

GitHub's protected-environment reviews and Argo CD's sync windows both check eligibility before asking a reviewer. A request that cannot run is refused up front rather than queued for approval. DPF adopts that ordering. Stripe's idempotency keys return the stored result, success or failure, for a replayed request within a window. DPF adopts this for failed approvals, where it previously did so only for successes. It rejects automatic client retries of the consequential POST, which Stripe permits only with a key that DPF's card does not hold.

### Verification

Unit tests for each deliverable. Production build. Runtime check after merge, on the live install: an OAuth replay of the incident's call by a non-owner returns `workroom_handover_not_owner` and mints no envelope.

## As built — approval lifetime (BI-0012E6CA, 2026-10-07)

Design §3 above says replay looks back over "the existing 15-minute window". That window was the single envelope lifetime, `AUTHORITY_APPROVAL_TTL_MS`. BI-0012E6CA split it into two:

- **Replay window.** `APPROVAL_REPLAY_WINDOW_MS` in `apps/web/lib/coworker/approval-lifetime.ts` is still 15 minutes. §3 behaves exactly as written.
- **Decision lifetime.** This is how long a person has to answer. It is now `approvalLifetimeMs(consequence)`: 15 minutes for an `outward` or unclassified call, seven days for everything else. Execution re-checks it against the call's current classification.

So "after the window, the coworker may ask again" refers to the replay window. A request that closes unanswered no longer disappears. It shows as **Expired unanswered**, and the delegating person can choose **Ask again** (`POST /api/agent/envelope/:id/reraise`). Deep links now open the request's own card instead of the outcome panel. The original text above is unchanged.

BI-130120F1 repairs the remaining status-read projection of this contract: a
`waiting` outcome returned by exact lookup or pending discovery uses the shared
`envelopeInboxRoute`, so the link opens that request's actionable card among
unrelated requests. Other outcomes keep `envelopeResultRoute`. The shared
projector remains read-only; identity checks, decision state, expiry, authorization
and execution are unchanged. Regression coverage joins the projected link to the
rendered card and preserves result-panel links for every non-waiting state.


## As built — the chat card raises approval requests (BI-7BCC87BB, 2026-10-07)

Approval convergence PR-B (spec `2026-10-07-approval-convergence-on-envelope-design.md`, D2 S1) moved the chat card from the AgentActionProposal to the CoworkerActionEnvelope. A coworker's proposal-mode call in chat now goes to the governed executor, which raises an approval request bound to the exact call; the assistant message lists the requests it raised, each with the shared Authorize / Decline (`EnvelopeDecisionButtons`, extracted from the Needs-you card). The same request is the Needs-you card. Authorize runs the call once through the monitor and the chat sends the "Result: <id>" follow-up. The recommendation/authorization split this spec set stays: the card names what the coworker recommends and what the person authorizes. An admin who is not the person asked can decide on their behalf with a recorded reason (plan B8, AC-OVERRIDE).


## Progressive disclosure amendment — BI-038AA4BC, 2026-10-25

The operator reported that approvals were too verbose and exposed internal IDs.
Live reproduction on served lineage `64e03a9f` found 258–298 default-visible words
on representative routine cards despite collapsed Technical detail. The action
renderer lived outside that disclosure and repeated the policy, identity grid
and report. Immutable source `74bebe9d`,
`CoworkerEnvelopeApproval.tsx:175–246`, establishes the same defect. Live baseline
activity: `cmvojwd5g5lm901qf8qk3yybo`. Three new behavior tests failed against the
unchanged renderer; name-access tests separately failed before enrichment.

The [working prototype](2026-10-25-approval-progressive-disclosure-prototype.html)
preceded implementation. Its buttons send no approval. It covers a blocked
report, a review result, a handover and an unresolved effect. The recorded item
body supplies the medium delivery shape's problem, options, choice, ordered work
and acceptance baseline; this amendment reconciles the earlier expanded-content
rule with that baseline.

### Presentation contract

- One decision block shows the specific question, affected work name, actual
  change, consequence, attributed recommendation and Authorize/Decline controls.
  Known report and research operations use their existing handler semantics;
  recorded claims remain claims, rather than proof the work succeeded.
- Reuse Surface, StatusBadge, the existing decision projection and shared
  EnvelopeDecisionButtons. Other attention sources keep their current shell.
  One deliberate Technical evidence disclosure contains the original identity,
  policy, proposed values and lineage. Why am I being asked? supplies brief help.
- Focus and deep links locate the decision without opening technical evidence.
  Native disclosure retains keyboard semantics. The controls remain outside
  disclosure, and decision, execution and completion remain separate states.
- Known report contents are evidence, not new payment or access instructions.
  Unsupported operations stay visibly unresolved and recommend holding. Their
  recorded recipients, amounts, currencies, recurrence, destinations, access
  changes, irreversible effects and deadlines remain visible without truncation,
  including nested and empty values. Full parameters remain available and bound
  to execution. No model-generated summary substitutes for exact consequences.
- Readable names are presentation enrichment. Canonical human Workroom content
  access is checked for the actual viewer, including an admin deciding on
  another person's behalf. Only then may the related backlog title be read for
  display. Missing access or enrichment yields an explicit unavailable name;
  no ID or fabricated label substitutes for it. Historical mixed backlog keys
  resolve through the existing id/itemId identities. No schema changes.
- No approval eligibility, grants, endpoint, stored binding, timeout, replay or
  scheduler rule changes. BI-E458A9CB owns the approval producer repair.

### Research and fit

The original GitHub, Linear and Slack comparisons still apply. This amendment
also follows [GOV.UK Details](https://design-system.service.gov.uk/components/details/)
for optional supporting information and the
[WAI-ARIA disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)
for operable expansion. Essential consequences stay outside disclosure, following
[progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/).

The design fits Workspace's existing inbox and operator persona, with contextual
controls only. It removes the duplicated default summary/grid and the forced
technical expansion on focused envelope cards. It adds no navigation home or
approval mechanism. The operator explicitly selected progressive disclosure.
Kernel comparison `DI-9C8C9D3CE3E2` ranked selective disclosure above shortening
the grid or hiding the action block, but returned low confidence and
`all-options-opposed` because the submitted feature coverage was incomplete.
That advisory is not an approval or a substitute for independent UX review.
Existing UX Design Critic engagement `CE-82A72FB4` remains requested; an advisory
handoff was refused for lack of an initiative-review packet. No completed
specialist critique is claimed.

### Required delivery evidence

Exercise representative cards against the served canonical shared preview at
320px and desktop, in light/dark themes and with keyboard/accessibility checks.
Measure real DOM budgets and commit the measured UX-fit manifest. Verify full
critical values, hidden technical reading order, focus, unchanged exact endpoints,
on-behalf identity, lost acknowledgements and failed execution. Canonical gate,
independent assessment, protected merge and live verification remain required.
A prototype or source-local pass alone is not runtime acceptance.

### Long inbox disclosure — observed 2026-10-29

The canonical full-size preview at d79d7c7 completed startup after the copier
repair. Its empty-approval baseline contained 18 real notices and measured 1,617
default-visible words against the frozen 428-word route baseline. This is a
regression, not qualifying UX evidence. Approval-case checks were incomplete
when the preview lease ended.

Extend the working prototype and reuse report-kit's CollapsibleList: show the
first three decisions in existing priority order, with a counted Show more
control at the foot and Show fewer after expansion. Preserve all data, actions,
material facts and existing explicit limit behavior. A deep link must reveal,
open and scroll to its target even beyond the initial three. Header counts name
items available in the view, rather than falsely saying every item is shown.
This applies to the shared decision list, including the weekly digest; the
cockpit's existing explicit preview limit remains authoritative.

Workspace remains the owning area, operator the persona, local disclosure the
only interaction change. No coworker request or approval is sent by expanding
the list. Existing specialist engagement remains requested, not completed. MCP
authentication is currently unavailable; source work follows the checked-in
recovery route and must be reconciled when connection access returns.

Add list expansion/collapse, explicit-limit and beyond-preview deep-link tests.
Repeat the real served DOM measurement and approval cases before publication;
no baseline relaxation or notice deletion is permitted. Source-local tests do
not establish that the 428-word runtime budget passes.
