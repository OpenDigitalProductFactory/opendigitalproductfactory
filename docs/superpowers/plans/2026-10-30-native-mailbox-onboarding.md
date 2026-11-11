---
status: active
Backlog: BI-C3171E2E
Profile: feature
Design: docs/superpowers/specs/2026-09-09-mailroom-email-triage-and-dispatch-design.md
Date: 2026-10-30
---

# Native mailbox onboarding repair

For agentic workers: execute this plan as one governed BI, branch and PR. Use
`dpf-tdd`, `dpf-local-merge-ci-before-push` and `dpf-pr-with-dco`.

## Acceptance (verbatim from the live BI)

- AC-1: Owner chooses a supported mailbox provider and sees its actual authentication requirements before connection.
- AC-2: Owner explicitly selects permitted business correspondence before any import from a mixed mailbox; credentials remain owner-entered on secure surfaces.
- AC-3: Connection is probed before saving; failure saves nothing and supplies a safe actionable remedy.
- AC-4: A permitted real message is read back once with accountable ownership, and recurring checking is verified through persisted evidence.
- AC-5: Provider failure, duplicate/thread handling and reply approval preserve existing scope and authorization.

## Design grounding

Extend the canonical Mailroom design section 9 and existing adapter contract,
MailboxAccount encrypted secrets, OAuthPendingFlow, IntegrationCredential,
Mailroom poller, room ingress, dedupe and pending-review reply draft. Research
and primary-source comparisons are retained in that design. Fresh origin/main
sweep found no Gmail Mailroom adapter; the live EP-EMAIL-COMMS query and open PR
list showed no other executor for this Google slice. The archived PR #6749
room is not duplicated. Provider readiness remains with its retained executor.

## Internal sequence (one deliverable)

1. SCOPE-CONTRACT: Test a strict explicit business-correspondent selection,
   safe Gmail query construction, read-only consent and cursor scope binding.
   Start with failing behavior tests; reject empty/wildcard/operator/self scope.
2. CONSENT-FLOW: Reuse pending flows and encrypted records for owner/browser
   bound, expiring, single-use PKCE consent. Verify granted scope and chosen
   mailbox profile before persisting. Add secure app configuration through the
   existing integration catalog; surface missing setup accurately.
3. MAIL-ADAPTER: Extend the canonical provider enum/maps/registry with a
   forward migration. Normalize scoped Gmail reads into existing intake, with
   bounded resumable pagination, attachment-metadata-only persistence and no
   send capability. Full MIME responses can contain inline attachment bytes;
   bound and discard those rather than promising no transfer.
4. GUIDED-CONNECT: Connect the prototype's Google journey to real server
   actions. Preserve advanced providers and the successful-first-read setup
   completion contract. UX specialist review needs actual governed captures.
5. VERIFY-NATIVE: Test cross-owner/replay/expired/declined consent, missing
   scope/account mismatch, first-read outage, duplicate/thread identity,
   recurring poll and refresh failure. Run affected provider/form/intake tests,
   both package typechecks, schema/data-impact guards, UX review and exact
   merged-code gate; ready PR only after required checks. Deploy only through
   canonical release and verify served identity before business acceptance.

## Verification references

The current Large design has canonical design, spec-approval and architecture
receipts at source `05dd73a118b99477e205eb99c425d3536c3ed881`, spec blob
`4686031d69dbc9ce87f37721660faba59daa45a0`. The scope baseline is
`baseline-922d1320-3295-4bf3-833b-dd1ec07af720` (10 objectives, 23 acceptance
checks). Planning admission `IRD-B94B6F9CE427` is allowed; implementation still
requires current coverage and independent plan review. CLIENT review
DOC-4247B8BD remains supporting assessment, not native approval. Historical
uncertain tasks and the exhausted E9 source-reader failure retain their own
identities; do not replay them. Address these concrete regressions:

1. AC-2/AC-5: first fail a deferred-provider test that narrows consent while a
   poll is active. Fence subsequent reads, ingestion/dispatch and cursor/status
   publication against the current saved consent, including the failure path.
   A stale error must not overwrite the replacement connection either.
2. AC-5: first fail an adapter-to-intake A → B → C test, then extend the existing
   thread continuity contract. Include duplicate delivery and customer/mailbox
   separation controls; do not merge solely by subject or unscoped headers.
3. AC-1/AC-2: guide selection with authorized recorded business candidates and
   explicit owner review before consent/reads. Unknown addresses remain unknown.
   Cover no candidates, unavailable permission and retained coworker progress;
   no extra grant, mailbox discovery or technical-label knowledge is assumed.
4. AC-3/AC-4: rerun affected source checks, obtain current independent and UX
   evidence, apply the migration through the governed target, then prove the
   real permitted email chain. Prior 192 source tests do not cover these new
   race/thread/guidance requirements or establish served acceptance.

- TEST-SCOPE: malicious or broad input never reaches Gmail, and changed scope
  cannot reuse an old cursor.
- TEST-CONSENT: wrong browser/user/org, expired/replayed state, declined or
  insufficient grant, profile mismatch and provider outage cannot save or read
  an unauthorized mailbox. Successful consent saves one encrypted connection.
- TEST-POLL: bounded pagination resumes without lost messages; failures keep
  cursor; existing idempotency, threading and recurring poll evidence applies
  only where the actual provider path is exercised.
- LIVE-EMAIL: owner selects real business scope and completes secure consent;
  DPF reads a permitted message, associates customer/work, records accountable
  owner and verified coworker result, and retains accurate draft for approval.
  Source tests, mocks and queued jobs do not satisfy LIVE-EMAIL.

## Risks and rollback

Google restricted-scope app readiness is a real external dependency. Never
substitute another assistant or ask for secrets in chat. A narrow correspondent
filter may exclude other business messages; no silent scope widening. Preserve
manual providers and existing mail data. Roll back source routing if necessary,
pause the affected mailbox through its governed action, and revoke provider
consent on the provider surface; never destructively erase correspondence.

## Backlog coverage

Atomic deliverable: BI-C3171E2E. SCOPE-CONTRACT, CONSENT-FLOW, MAIL-ADAPTER,
GUIDED-CONNECT and VERIFY-NATIVE are internal sequencing: an unconnected adapter
or consent button cannot safely deliver native onboarding. No separate product
outcome is claimed for those pieces. Canonical coverage receipt is recorded
against this immutable plan; its receipt id belongs in Workroom evidence so the
plan blob need not mutate merely to cite its own digest.

The older coverage receipt cmvubgfdr3a4u01o2rjqmttos is historical and malformed
for the current Large baseline. Replace it through the v2 coverage writer using
this plan's provider-verified immutable blob before implementation admission.
No receipt is asserted here before that write succeeds.

## Current baseline traceability

The new deliverable is atomic native Google onboarding (BI-C3171E2E). Existing
Mailroom capabilities are compatibility obligations of this same adapter path,
not new independently shippable features. Consent without guarded reads, reads
without intake continuity, or a connect screen without safe consent cannot
deliver this outcome independently. The five phases above remain internal
sequencing, with one independently reviewable product change. If inspection
reveals a separate missing core capability, reuse its live BI and amend the
delivery graph rather than silently expanding this atomic claim.

The full immutable spec, including the Gmail tail, must be read during plan
review. Spec-approval's genuine receipt disclosed an unread tail and counted
7 objectives/22 checks; it does not establish complete review of this 10/23
baseline. Architecture approval explicitly requires implementation of concurrent
consent fencing, three-reply continuity and guided business-contact selection.

| Requirement references | Verification references | Contract references | Flow references and evidence |
| --- | --- | --- | --- |
| OBJ-MAIL-DECLARED-MAILBOXES | AC-MAIL-SETUP-STEP, AC-MAIL-PURPOSE-REGISTRY, AC-MAIL-CONNECT-LATER | CONTRACT-SETUP | FLOW-CONNECT: preserve setup/mailroom purpose registry, pause/retest/remove behavior and existing advanced providers; exercise served connect flow. |
| OBJ-MAIL-NEAR-HOURLY-INTAKE | AC-MAIL-POLL-SCHEDULE, AC-MAIL-IDEMPOTENT, AC-MAIL-PROVIDERS | CONTRACT-ADAPTER | FLOW-POLL: real registered poll job, provider parity, persisted next-poll/outcome, repeated-delivery controls and recovery. |
| OBJ-MAIL-TYPED-TRIAGE | AC-MAIL-TYPED-REASON, AC-MAIL-NOISE-FIRST, AC-MAIL-UNTRUSTED | CONTRACT-INTAKE | FLOW-TRIAGE: existing registry-constrained reason/urgency, rules-first noise and untrusted-content controls; run affected intake tests. |
| OBJ-MAIL-ROUTED-TO-OWNER | AC-MAIL-QUEUE-ROOM, AC-MAIL-KNOWN-SENDER, AC-MAIL-OWNER-NOTIFIED | CONTRACT-INTAKE | FLOW-ROUTE: existing room ingress, scoped queue association and responsible-role notification; verify persisted owner and customer boundaries. |
| OBJ-MAIL-CHASED | AC-MAIL-ACK-WINDOW, AC-MAIL-NEEDS-YOU | CONTRACT-ACK | FLOW-ESCALATE: persist urgency clock, acknowledgement actor/time and missed-ack attention escalation on the governed target. |
| OBJ-MAIL-REPLY-INSIDE | AC-MAIL-DRAFT-REPLY, AC-MAIL-APPROVED-SEND, AC-MAIL-NO-SMTP-HONEST | CONTRACT-REPLY | FLOW-REPLY: accurate pending-review draft, scoped threading and honest outbound-unavailable state. Test approved-send behavior only with a simulated provider or separately approved controlled target; do not send customer mail. |
| OBJ-MAIL-EDUCATES-WHEN-EMPTY | AC-MAIL-SKIP-EDUCATES, AC-MAIL-EMPTY-STATE | CONTRACT-SETUP | FLOW-CONNECT: verify recorded skip, useful empty state and secure next action with no technical-label prerequisite. |
| OBJ-GMAIL-CONSENT, OBJ-GMAIL-BOUNDARY | AC-GMAIL-GUIDED, AC-GMAIL-CURRENT-CONSENT | CONTRACT-CURRENT-CONSENT | FLOW-CONSENT: guide existing authorized contacts, preserve unknown addresses, secure PKCE/account binding; deferred-provider race tests and served selection/consent verification. |
| OBJ-GMAIL-RETAIN, OBJ-GMAIL-BOUNDARY | AC-GMAIL-THREAD-CHAIN | CONTRACT-THREAD | FLOW-THREAD: adapter-to-intake A→B→C, repeat delivery, separate customer/mailbox controls; never merge by subject alone. |
| OBJ-GMAIL-RETAIN | AC-GMAIL-REAL-EMAIL | CONTRACT-ACCEPTANCE | FLOW-LIVE: one permitted real business email through DPF connection, intake, association, accountable owner, verified coworker result and approval-held accurate draft. |

## Atomic effect boundaries and verification order

1. Before production-code edits, claim implementation only after coverage and
   independent plan review pass. Resolve each Workroom testImpact entry and
   guardObligation; the current impact contract covers 44 retained WIP paths.
   Refresh that contract if the repair adds paths. Preserve all prior WIP.
2. TEST-CONSENT-RACE: add a failing deferred-provider test before changing the
   runtime. Capture the persisted consent identity before polling. Revalidate
   before each subsequent body request. Use a conditional transaction against
   that same current identity at intake publication/dispatch and cursor/status
   commits. Fence successful and failed stale polls, including a selection
   narrowed after an already admitted network request. A separate read followed
   by an unconditional write is insufficient. Reuse existing effect guards;
   any missing primitive returns to architecture review before introduction.
3. TEST-THREAD-CHAIN: fail adapter-to-intake three-message continuity first;
   retain provider thread identity or the scoped header root. Include duplicate,
   cross-mailbox and cross-customer controls at the same boundary.
4. TEST-GUIDED-SCOPE: fail missing-candidate/denied-read/unknown-address cases
   before changing the form. Query only contacts the current actor may already
   read, display exact proposed correspondents for explicit selection, allow
   secure manual contact entry, and never inspect mail to discover candidates.
5. Run affected provider/consent/form/intake tests and both package typechecks;
   exercise schema migration safety, data-impact/classification, generated
   route/doc artifacts, prose/style guards and all impact-contract guards.
   Obtain measured UX evidence and exact merged-code canonical gate evidence
   before ready PR handoff. Prior 192 tests do not prove these new regressions.
6. Use the shared governed target for migration and served verification. Reuse
   valid existing evidence per workflow only after checking its actual provider,
   source and scope. Record unrun compatibility checks explicitly; a table row
   maps responsibility and never asserts a pass. Secure provider app setup and
   owner consent remain human-entered. Deploy through the sole release owner
   and verify served bytes before LIVE-EMAIL acceptance. Never substitute
   another assistant's Gmail connection or widen business scope.

Current state: retained source WIP exists; further product edits await current
plan coverage and review. Secure provider setup, measured UX review, exact
runtime gate, deployment and the real-email chain remain unrun.
