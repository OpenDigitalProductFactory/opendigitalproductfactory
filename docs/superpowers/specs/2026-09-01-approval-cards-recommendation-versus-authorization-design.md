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
