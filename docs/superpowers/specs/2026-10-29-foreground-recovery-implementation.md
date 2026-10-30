---
status: active
---

# Retained foreground coworker requests

BI-D0D2FF0D · WC-02CBE4C1 · CEO dogfooding repair

## Outcome and scope

An accepted conversation request must survive a lost queue wake or a safe
pre-inference provider-capacity refusal. The owner should not retype the request.
This change extends TaskRun, the existing queue and scheduled dispatcher, the
canonical resource-wait projection, and the existing execution fence. It adds
no schema, cron, provider, ledger or permission grant.

The original user message, assigned coworker, owner, route, mode, extras and
absolute one-hour recovery deadline are bound by a request digest. A stable
browser request key makes repeated HTTP submissions reuse the original message
and TaskRun. Admission links the exact accepted message and saves the receipt
and immutable task input in one transaction.

The worker claims one generation with a compare-and-set. Current user and
conversation ownership are rechecked, and tool execution receives the captured
generation fence. Only explicit capacity/busy refusal before any executed tool
may retry; the canonical five-attempt bound and original deadline apply.
Cancellation and superseding generations cannot be overwritten by late results.
An unknown execution outcome is held for reconciliation, never replayed.

The existing dispatcher repairs lost wakes, dispatches due capacity waits, and
holds expired interrupted workers with canonical execution uncertainty. Holds
are explained in the persisted conversation. Approval proposals remain pending;
a completed response records turn settlement, not business-result acceptance.

## UX fit review

- Proposed decision: fits with guardrails; specialist result remains unrun.
- Owning area: Workspace, existing route coworker conversations.
- Persona: business owner delegating work without managing recovery machinery.
- Navigation: no new route or dashboard; a request-details disclosure in the
  existing system-message renderer exposes the reference when needed.
- Reuse: AgentMessageBubble, AgentCoworkerPanel and persisted AgentMessage.
- Source truth: retained TaskRun and its bound message; a rendered receipt is
  never completion evidence.
- Failure: retain the request, explain the hold, preserve original authority.
- AI boundary: reading the receipt or its details sends no prompt.
- Prototype: `2026-10-29-foreground-recovery-prototype.html`, example data only.
- Specialist engagement: CE-E46D47D4, requested, not fulfilled or passed.
- Recorded advisory DI-630E1BFBFE6B was low-confidence/all-options-opposed with
  incomplete feature coverage. It is not approval or a qualifying UX manifest.
- Current blocker: capture_ux_critique discovery reports agent-grant-missing
  (critique_capture). No alternate credential, database write or self-grant used.

## Verification and remaining evidence

Source-local tests cover duplicate HTTP submissions, concurrent queue claims,
the immutable request/deadline, capacity retry, expiration, authority revocation,
changed coworker and execution generation, cancellation, pending approval,
unknown outcomes and lost advisory wakes. Both TypeScript programs passed before
the final persisted-notice change; refreshed checks remain required.

Publication requires exact merged-code gate evidence and the normal protected
PR. UX needs rendered evidence, the measured manifest and the specialist review.
Served acceptance must exercise the original COO and Finance requests and verify
their requested stored artifacts or business effects. None of these served
checks is replaced by unit tests, a queue acknowledgement, or a merged PR.

This implementation does not establish mailbox consent, connect Gmail, send
mail, prove the email-to-ticket lifecycle or verify MSP customer isolation.
