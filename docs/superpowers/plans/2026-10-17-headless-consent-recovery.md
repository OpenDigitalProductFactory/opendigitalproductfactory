---
status: active
backlog: BI-79D26E39
---

# Recover operator-bound headless consent delivery

Workroom WC-A2931E83; branch fix/credentials-client-consent. Reuse the recorded
founder decision and canonical OAuth design amendment. Preserve original
implementation295d5e246c6a7208a87f08f6f579a3eaebc8afc7 and its history.

**Backlog item:** BI-79D26E39

## Acceptance criteria

- AC-1: a client_credentials token for a client bound to an eligible approved agent carries an active consent binding, and `connectionDelegationFor` returns steering for it (test).
- AC-2: a credentials client with no agentId, or an owner/agent the consent rules reject, gets no binding (test).
- AC-3: a repeated grant reuses the same binding instead of creating one per token (test).
- AC-4 (live): a Grok session claims a workroom and records research evidence with no approval envelope; damaging actions still escalate.

## Existing findings and repair

The independent client assessment found two blockers in295: filtering consent
history to active rows can recreate revoked authority; concurrent first grants
can each create a binding. Neither finding is fixed at this checkpoint.

After fresh immutable coverage, write failing revocation and concurrency tests.
Refactor lookup, validation and first creation into one transaction. Reuse a
canonical row lock for the existing credentials client; inspect consent history
under that lock. Existing revoked or invalid consent must not silently mint a
replacement. Preserve eligibility, human/client/resource/assistant scope and
the token resolver's current checks. No table, grant, provider or alternate
credential is introduced. Keep no-agent and ineligible-agent behavior explicit.

Run affected consent, token-route, token-resolution and delegation tests and
both TypeScript programs. Recheck the final exact diff independently, resolve
all blocking findings, and use the protected PR and merge queue. Documentation
must explain revocation and concurrent reuse in the canonical OAuth design.
This internal authorization repair adds no rendered interface.

## Recovery sequencing and evidence

The original shared gate cannot execute approved headless requests without a
consent binding. The human authorized bounded DEV blocker repair. One branch-only
source checkpoint publishes the existing design so current immutable coverage
can be recorded before new production edits. DCO, secret checks and mandatory
host guard parity remain. Known findings stay open; integration and native review
remain UNRUN. This checkpoint is not a PR, merge, image, runtime qualification or
passing gate. Do not roll the native head backward to fit an old plan locator.

After actual checkpoint publication, record and validate fresh coverage, refresh
normal implementation admission, then repair. Any final publication exception
must retain integration as UNRUN and native review disposition separately;
protected CI remains mandatory. Canonical Docker release and governed deployment
stay with the existing release coordinator. Verify source containment and live
acceptance before completion. Never replay uncertain historical tasks.

## Backlog coverage

- Decision: atomic
- Parent: BI-79D26E39
- Receipt: cmvd2i75h207001mmwnwju4p5
- Rationale: consent capture, revocation preservation and serialization form one repair; tests, documentation and verification are phases of that repair.
- Dependencies: none

Decision: atomic. Consent capture, revocation preservation and serialization
form one independently shippable repair under BI-79D26E39. Tests, documentation,
publication and live verification are phases, not separate deliverables.
Requirements AC-1 through AC-4; contract operator-bound-client-consent;
flow client-credentials-to-consent-to-connection-delegation;
verification consent-revocation-and-concurrent-first-grants.

The checkpoint actually published1fa3760c4494bb4d126f3f533e857362f8be1bcc;
all84 host guard groups passed in501.0s. Current coverage was recorded and checked
valid before production edits, followed by implementation admission
IRD-769AB447B6B4. The initial atomic receipt request incorrectly marked its phase
independently shippable; validation refused it without a receipt, and the
corrected sequencing-only request produced the receipt above. No earlier receipt
or source identity was relabelled. New revocation and concurrency tests first
failed4/9 on the original production code. The concurrency unit fixture models
transaction lock ordering; it is not real PostgreSQL atomicity evidence.

Corrected source passed267 tests across15 suites, both production/test TypeScript7
programs, prose/style/token checks and all14 diff-scoped local gates. The first
typecheck found a nullable identity captured across an asynchronous callback;
capturing the already-validated agent identity fixed it before the passing run.
Independent final assessment, full shared integration, real PostgreSQL
qualification and served acceptance remain separate pending obligations.
