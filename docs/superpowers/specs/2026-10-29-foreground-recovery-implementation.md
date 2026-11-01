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
- The owner applied the approved critique_capture grant. The native writer and
  image persistence/readback were actually verified on served capture repair
  9efdf08 (DOC-86CDD5DC and the linked draft critique). This does not supply the
  missing rendered prototype or passing specialist review. No new grant is needed.
- Genuine rendered input remains missing. Native managed prototype DOC-DEE7B803
  preserves the published HTML; native PDF export returned converter-unavailable.
  A refused browser local-file route was not bypassed with an alternate server.
- The immutable prototype was published at
  0f7af35c5dc581e23cca1966f349b43afbd249cc, blob
  350dd91ed1522b8a8133b4edfc629732dfc67feb. This repairs publication order;
  it does not assert the prototype preceded the original implementation.

## Verification and remaining evidence

Source-local tests cover duplicate HTTP submissions, concurrent queue claims,
the immutable request/deadline, capacity retry, expiration, authority revocation,
changed coworker and execution generation, cancellation, pending approval,
unknown outcomes and lost advisory wakes. Final source checks included 72 and
37 affected tests and both TypeScript programs passing. Those source results
do not establish the unrun exact runtime gate or business acceptance.

Publication requires exact merged-code gate evidence and the normal protected
PR. UX needs rendered evidence, the measured manifest and the specialist review.
Served acceptance must exercise the original COO and Finance requests and verify
their requested stored artifacts or business effects. None of these served
checks is replaced by unit tests, a queue acknowledgement, or a merged PR.

This implementation does not establish mailbox consent, connect Gmail, send
mail, prove the email-to-ticket lifecycle or verify MSP customer isolation.

### Controlled Finance adapter coverage

The Finance occurrence in managed DOC-82684072 v1 used
`/finance/expense-claims` and asked for the entry path and required receipt
information, without creating an expense or moving money. The original review
author confirms that no conversation, message or TaskRun ID was captured.
Recovery of that historical request is therefore unproven; do not invent its
identity or count a new fixture as its continuation.

`foreground-work-finance.integration.test.ts` exercises the real retained worker
with the real execution-context and generation checks. Its controlled storage
and coworker doubles cover one retained Finance request across a capacity wait,
duplicate queue deliveries, one linked fixture-result readback, a possibly saved
result followed by uncertainty, and authority revocation before capacity returns.
No browser session is available to lend authority to the queue callback.

At the October 30 checkpoint, all three cases passed. A temporary mutation that bypassed the real execution
context made all three fail; restoring the unchanged production implementation
returned the four adapter suites to green (25 tests). The mutation is not part of
the change. These results establish adapter composition against controlled
doubles, not PostgreSQL durability, real Finance tool execution, expense/payment
safety or served acceptance. Reuse the existing cross-boundary harness under
BI-7DC3B91D for those checks rather than adding another execution engine.

October 31 independent CLIENT review found that the retained source admitted
the legacy specialist while execution used the default unified coworker,
checked the deadline only before preparation, and published late responses
before checking settlement ownership. Tests reproduced these failures against
the production resolver and response path before correction. Admission now
uses the same async resolver and saved flag as execution, including selected
canonical/runtime identities. Context entry requires the worker's captured
generation; it cannot borrow a replacement generation. The existing governed
deadline contains preparation and provider admission/cancellation under current
actor, thread and immutable request authority.

A short transaction locks the existing TaskRun, rechecks the captured fence,
actor/thread/agent/archive state and original deadline after the lock, and
accepts the response, disposition and result identity together. Writes crossing
the deadline roll back. Accepted output survives return interruption without
repeating inference. Pending approvals keep their fence; explicit capacity waits
keep the canonical retry projection and visible no-resend explanation. Ordinary
completed-task redelivery can return the accepted payload without inference.
Form suggestions retain the original form identity and registered field keys;
the client applies a matching job/form/message once, including completion before
HTTP acknowledgement. A new or unknown form/job cannot receive an old proposal.

Special-command database changes share this boundary. Optional detached memory,
fact, checkpoint and observer work is suppressed for retained foreground turns;
the accepted message remains available for later governed derivation. Bounded
response-artifact/evidence writes describe accepted output and cannot cause a
new inference after interruption.

The old programmatic orchestrator/scout/ideate calls do not carry an accountable
parent TaskRun/fence into native child execution. This foreground path therefore
retains and blocks those calls before dispatch, with the platform responsible;
it does not silently route around the existing Build Studio engine or ask the
owner to resend. Restoring that governed handoff is an unfinished capability
boundary under the existing cross-boundary/recovery owners.

Source verification includes genuine first-failing identity, deadline,
late-publication, replacement-generation, lost-acknowledgement and original-form
delivery cases. Controlled tests exercise the real worker/context/publication
composition and production response path with persistence/provider doubles.
Four PostgreSQL lock-order/expiry/rollback cases use the existing isolated-schema
fixture and only an explicit governed SQL test URL. They remain unrun locally
when that URL is absent; mocks are not database proof. Final exact gate,
independent source reaffirmation and all owed UX/served business evidence remain
required before delivery acceptance. The historical Finance request remains
unbound and is not recovered by these new fixtures.

November 1 verification ran all four actual PostgreSQL cases on source
96c458fd869bcd1f950c3f310e33afee971894d6 in its admitted disposable preview.
All four passed with no skips. The preview later lost its lease after
initialization, before authenticated page and automatic-resume acceptance;
those checks remain unrun. Keep database evidence separate from served UX.

A distinct private COO draft on canonical7396 returned the requested agenda
but also answered an older failed request. The historical run's settlement
is unknown; that text does not prove it resumed. Actual sendMessage regression
tests first failed for missing current-row pinning and missing historical
context labels. Current input is now pinned once by persisted message ID after
history compaction, with older user requests labelled as context. The prompt
binds the assignment to that stable marker rather than final message position:
later tool-failure hints are user-role messages too. An actual loop-continuation
regression loses the binding when the positional behavior is restored and
passes with the stable marker. This preserves existing current-input tool
authority and does not invent outcomes for excluded historical failure notices.
Real model behavior and the full workflow still require served verification.
