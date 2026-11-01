---
status: draft
---

# Business email to accountable service work

Backlog: BI-ACB5C0F3. Workroom: WC-15F76053. Delivery shape: large; design intent only. Source inspected: main `4de8502eebca9117ca1e30b6430a752b48f3276c`, refreshed from the initial main49f9 inspection. This document is a proposed scope, not independent approval or implementation authority.

## Outcome and limits

One permitted business email becomes correctly scoped customer work with an accountable owner, visible response obligations, a verified coworker result and an accurate threaded reply draft awaiting approval. The operating installation is the first proof. The reference three-person MSP serving 60 customers is a workflow acceptance target, not a claim that DPF replaces its approximately 36 tools.

Extend the existing Mailroom and ServiceTicket. Preserve the canonical delegated-support design's D1–D5 ownership; this email bridge does not implement another identity, customer-consent, edge-control or MSP topology system. BI-C3171E2E owns native mailbox onboarding and current-consent/thread corrections. BI-D0D2FF0D owns delegated-job continuity. BI-26F05107 and BI-FB8DCBC1 own the wider served MSP acceptance. Their completion is not inferred here.

## Design grounding and observed gaps

| Existing source | Reuse and observed constraint |
| --- | --- |
| `packages/db/prisma/schema/crm-commerce.prisma`, `packages/db/src/service-ticket-types.ts` | ServiceTicket already has customer/site scope, ownerPrincipalId, SLA policy/due time and lifecycle timestamps. Reuse its closed kind/status unions and transition rules. CustomerAccount has no organizationId; do not invent an implicit organization relationship. |
| `apps/web/lib/mailroom/intake.ts`, `dispatch.ts`, `runtime.server.ts` | Existing provider intake, idempotency, typed triage, known-sender ingress, queue notification and recurrent checking. Generic queue routing alone does not create a customer-scoped service ticket. |
| `packages/db/prisma/schema/marketing.prisma` | InboundChannelMessage carries organization, mailbox, thread, routed work, acknowledgement and reply facts. Its current message uniqueness is channel/message; the C317 scope correction must preserve organization/mailbox isolation. |
| `apps/web/lib/work-management/source-registry-mailroom.ts` | Standing queue source has no account resolver. Preserve this correspondence queue; never expose all its messages as one customer's case. |
| `work-management/work-unit.ts`, `source-registry.ts`, `status-projection.ts`, `portal-case-loader.ts` | Use an existing WorkItem carrier and one canonical service-ticket case. Extend source registration/account resolution and the shared projector; no new carrier kind, second lifecycle or independent customer-facing status mapper. Portal reads already reject a case whose resolved account differs. |
| `apps/web/lib/mailroom/reply.ts` | Existing pending-review OutboundDraft and explicit approved-send path, including thread headers. Controlled probe proves the fallback falsely asserts active work without owner evidence. |
| `apps/web/lib/actions/coworker-response-persistence.ts`, `apps/web/lib/routing/response-producer.ts` | Newly delivered response attribution binds the owning user/thread/task/room and hashes final stored content. Reuse that provenance; a model response and its digest alone do not prove the requested business outcome. |
| `docs/superpowers/specs/2026-10-12-msp-customer-setup-delegated-support-design.md` | Canonical customer delegation, identity, consent and edge lifecycle. Existing BI-3CC2E798, BI-E4E037F2 and BI-D07F2DE9 retain those deliverables. |

Actual source probe `/tmp/dpf-mailroom-reply-honesty-probe.ts` imported reply.ts blob `cecaa3ec10bb6a0cbefa40ff67f4c43cb8cf759b`, identical on inspected main and provider3ac4. Receipt-wording control passed; the no-unsupported-active-work assertion failed for an item with no routed work. No provider, database or mail call occurred. C317's separate controlled thread/consent failures remain its evidence, not a new executor assignment here.

Live overlap: ACB had no active room before this claim. Historical EP-MSP-FEDERATION does not resolve here. Current EP-0AC73AEA has five items including the existing D2/D4/D5 owners; no duplicate epic or edge deliverable is proposed. BI-AE128860 is deferred topology work, not proof of implemented support authority. The code graph reports main49f9/high trust with four of five structural relationship types; its ServiceTicket hits corroborate the schema, and missing relationships prove no absence.

## Research and retained decisions

Primary documentation inspected 1 November 2026. No dependency, subscription or external workflow is adopted.

| Comparator | Adopt | Reject or qualify |
| --- | --- | --- |
| [Zammad email settings](https://admin-docs.zammad.org/en/latest/channels/email/settings.html) | Resolve replies against existing message references and preserve ticket conversation identity. | Subject/body matches can falsely associate mail. Never use them alone to select a customer or cross a boundary. |
| [osTicket email intake](https://docs.osticket.com/en/latest/Admin/Emails/Emails.html) and [scheduled polling](https://docs.osticket.com/en/latest/Getting%20Started/POP3-IMAP%20Settings.html) | Separate mailbox routing, intake and recurring execution; prove polling actually runs. | Do not ask this business owner to configure a scheduler, install an external help desk or enter passwords in chat. Use DPF's existing scheduler and guided consent. |

[RFC 5322 section 3.6.4](https://www.rfc-editor.org/rfc/rfc5322#section-3.6.4) supplies message-identifier and reply-reference semantics. These headers establish conversation references, not customer authority. Preserve the existing IT4IT Detect to Correct, Request to Fulfill and Change mapping from the MSP design. Reuse the ratified universal-work formula rather than introducing a ticket-specific execution engine.

## Objectives

**OBJ-EMAIL-01:** Associate permitted inbound mail with exactly one customer-scoped ticket and canonical work case, or retain an explicit unresolved intake exception.

**OBJ-EMAIL-02:** Keep an accountable owner, acknowledgement and response obligations visible while delegated work retains its identity through recoverable provider failure.

**OBJ-EMAIL-03:** Produce customer replies from scoped, verified facts and retain human approval; receipt, assignment, execution and resolution are distinct facts.

**OBJ-EMAIL-04:** Prove recurring checking, thread/duplicate isolation and the existing customer-approved edge exception on authorized served targets.

## Proposed implementation contract

### Intake and customer boundary

Consume an accepted InboundChannelMessage only after the current mailbox-consent fence. Require organization, mailbox, normalized message identity and current authority at the read and effect boundaries. Reuse C317's stable provider/thread and consent primitives once admitted; do not patch its frozen adapter work in this branch.

Resolve a customer from an existing verified relationship/channel binding or an explicit operator-confirmed intake association. A From address, domain, subject, quoted ticket number, model classification or mailbox connection is not such authority. Ambiguous or unknown senders stay visibly unassigned in the existing triage queue. They receive no customer records or implied service result.

A ticket's customer, site and source-mail scope must agree before appending, loading context, assigning work or drafting. Resolve the account through the ticket and existing portal authority checks. Where a necessary account-to-organization assertion is unavailable, fail closed and name the missing relationship; do not manufacture an organizationId on CustomerAccount or infer it from the install. Reuse the delegated-support authority owner for external technicians and sovereign customers.

### One ticket, one case, durable conversation

Register a service-ticket source using an existing WorkItem carrier and its canonical source-tuple creation helper. Resolve one WorkItem/case per ServiceTicket; use `encodeWorkCaseKey` and canonical room anchors. The standing Mailroom queue remains a correspondence container referencing that case, not a second copy of the service unit. Domain status remains ServiceTicket input to `status-projection.ts`.

Use a deterministic, database-unique ticket creation identity derived from the validated organization/mailbox/customer/thread tuple, following the existing deterministic incident-ticket precedent. Do not repurpose correlatedIncidentKey or estate scopeKey as email storage. Persist validated linkage in the existing inbound metadata/source references, transactionally with the ticket/case association. A retried delivery or concurrent worker must find the same ticket, case and message effect. If the existing unique facts cannot enforce that atomically, obtain data review for the minimal extension before implementation; JSON matching alone is not a concurrency fence.

Resolve subsequent mail using the scoped stable provider thread and stored message references. Never search globally by subject or arbitrary References. A foreign-customer reference is an intake exception, not an invitation to append. Preserve ServiceTicket's existing closed/resolved transition rules; a closed thread does not silently reopen or lose the new enquiry. Reopening or a linked new ticket follows explicit existing policy.

### Ownership, clocks and coworker result

Assign only an eligible Principal within the customer's current support envelope using existing assignment/capacity machinery. An absent owner stays an explicit exception with escalation; a queued job is not an acknowledged or completed job. Record assignment, acceptance, work attempt and verified outcome separately.

Retain the existing Mailroom acknowledgement window and recurrent chase. Resolve customer response/resolution obligations from recorded service policy and operating hours. Never invent contractual deadlines. When policy is absent, show that gap while the existing internal acknowledgement obligation continues. Preserve initial receipt time, due times and breach history across retries and provider waits. A draft awaiting approval does not count as a sent first response. Follow-up messages retain their own unanswered obligations without resetting the original first-response clock.

Delegate through existing durable TaskRun/coworker machinery with the original identity, scope, budget and cancellation checks. Provider failure retains accountable pending work and an actionable recovery state. Do not use Codex's Gmail, replay uncertain effects or require the owner to resend. A verified result must name its actual job/result evidence and customer scope; a model's text or a terminal queue status is insufficient.

### Accurate reply and resolution

Feed reply composition only the permitted conversation and verified scoped facts. A holding fallback may acknowledge a persisted receipt; it may not assert assignment, active work or a result without the corresponding evidence. Treat inbound instructions as untrusted data. Provider failure must remain explicit and must not turn into a fabricated customer promise.

Reuse OutboundDraft, approval envelopes and the approved mail transport. Check customer, recipient, current authority and evidence again before a consequential send. This repair's acceptance stops at an accurate draft awaiting approval; no customer mail is authorized by the repair instruction. Only a verified transport receipt records a send/reply and satisfies a response clock. Resolution requires the actual supported outcome and existing governed transition; an internal acknowledgement or holding reply does not resolve the ticket.

For edge exceptions, reference the existing customer-side remediation proposal, approval and result contracts. A ticket, email or MSP policy grants no extra endpoint authority. Consume the result only when its customer/site/asset and individual actor match. Real target enrollment and each consequential action require their existing customer authorization.

## Acceptance baseline proposed for independent review

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-EMAIL-01 | OBJ-EMAIL-01 | One permitted message creates one correctly scoped ServiceTicket and canonical case, or an explicit unresolved intake exception. |
| AC-EMAIL-02 | OBJ-EMAIL-01 | Duplicate delivery and concurrent intake create no duplicate ticket, case, message effect or owner notification. |
| AC-EMAIL-03 | OBJ-EMAIL-01 | A three-message reply chain retains one scoped ticket; identical subjects and foreign-customer references cannot merge unrelated work. |
| AC-EMAIL-04 | OBJ-EMAIL-01 | Unknown, ambiguous, revoked or mismatched customer scope exposes no other customer's ticket, mail, context or draft. |
| AC-EMAIL-05 | OBJ-EMAIL-02 | Work has an eligible accountable Principal or an explicit visible assignment exception; assignment and acknowledgement persist through reload. |
| AC-EMAIL-06 | OBJ-EMAIL-02 | Internal acknowledgement and policy-based customer response clocks retain their starting facts and breach history; drafts and provider waits do not falsely satisfy them. |
| AC-EMAIL-07 | OBJ-EMAIL-02 | Recurring checking and missed-acknowledgement escalation execute through DPF's scheduler and produce persistent readback without owner resubmission. |
| AC-EMAIL-08 | OBJ-EMAIL-02 | Provider unavailability retains the original authorized job and recovers only after safe settlement, with no duplicated or uncertain customer effect. |
| AC-EMAIL-09 | OBJ-EMAIL-03 | No fallback or composed reply claims an owner, active work or resolution without matching evidence; the captured unsupported-active-work counterexample becomes green. |
| AC-EMAIL-10 | OBJ-EMAIL-03 | A verified scoped coworker result produces an accurate threaded pending-review draft; this acceptance sends no customer mail. |
| AC-EMAIL-11 | OBJ-EMAIL-03 | Only an explicitly authorized transport receipt records reply completion; failed send or revoked authority leaves the draft and clock honest. |
| AC-EMAIL-12 | OBJ-EMAIL-03 | Resolution and follow-up follow existing governed ticket transitions and supported outcome evidence, including a policy-controlled closed-thread exception. |
| AC-EMAIL-13 | OBJ-EMAIL-04 | Cross-customer and cross-mailbox negative cases fail closed at intake, case read, delegation, reply and edge-result association. |
| AC-EMAIL-14 | OBJ-EMAIL-04 | An authorized test target proves the existing customer-approved remediation exception with individual actor, exact target and result evidence; no wider edge access is implied. |
| AC-EMAIL-15 | OBJ-EMAIL-04 | Served proof records exact code/image, database readback, actual executed/skipped cases and one real permitted Business email through the complete draft-awaiting-approval milestone. |

## Delivery and review boundaries

Follow the linked [phased plan](../plans/2026-11-01-email-ticket-lifecycle-plan.md). Research/spec approval, architecture/data/security/UX and plan review remain unrun for this proposed scope. Obtain native independent receipts and live coverage before implementation; a CLIENT review cannot mint a Large baseline. Produce and render the required UX artifact before UI implementation, using DPF's authorized rendering route. No local-file browser workaround or substitute original engagement is permitted.

Funding purpose is unresolved in the new room. Read and resolve its existing funding authority before budget-bearing reviewer dispatch; do not infer the funder or authorize spending from this design claim. Customer policy, secure mailbox consent and consequential actions remain with their recorded business actors. No deployment, mailbox/customer access, runtime code, migration or access widening is delivered by this document.
