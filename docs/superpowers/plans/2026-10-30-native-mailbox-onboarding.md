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

Before further implementation, recover the required Large feature admission;
the original independent review remains unknown. CLIENT review DOC-4247B8BD is
an assessment, not a replacement approval. Preserve the retained source and
original request identity. Then address these concrete regressions:

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

Current state: native source implementation and source regression checks are in
progress. Plan coverage receipt cmvubgfdr3a4u01o2rjqmttos binds the initial immutable
plan9105745d5677bb9827a175095b1f6d7d1bc97a26. Secure provider setup, measured UX
review, exact runtime gate, deployment and real-email acceptance remain unrun.
