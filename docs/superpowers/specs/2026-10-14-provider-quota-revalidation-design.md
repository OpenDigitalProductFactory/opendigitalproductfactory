---
status: active
---

# Reconcile an account verification with its stale quota restriction

Existing backlog coverage: BI-38064739. Delivery follow-through in BI-3CF78C8E / WC-26F4D73B; no duplicate intake or provider-account substrate.

## Observed failure

The operator received an early subscription allocation, but the portal retained a quota reset on October 20. Approved account verification `cmv7mdepj16z301mx699bjvwg` actually completed through the existing ChatGPT Responses endpoint. Immutable served source `57f1adff2687010d3b3bddf7b3a3e589a0c46217`, blob `91c5ffb6dcd90d608684c9e295cba4c2a935e61e`, skips quota clearing whenever an explicit connection is selected. Authentication success consequently need not restore routing.

This does not establish Codex CLI access or clear data-use restrictions. The output-fit repair merged in PR #6338 at `26e9d0f1da420a0ea0daeffc408a81624477a34c`; its native review remains inconclusive. The canonical deployment containing that repair is separate from this source change.

## Design and scope

Reuse `testProviderAuthInternal`, strict Responses completion validation, `AiProviderConnection` ownership, and `ProviderCapacityStatus`. Capture the existing quota row before the bounded request. Reconcile inside the transaction that checks the selected connection's credential and version and marks it authenticated.

An explicitly linked capacity row belongs to its recorded connection. An unlinked legacy provider row can be reconciled only by the canonical default connection whose credential is also the provider's legacy default credential. A name alone does not establish ownership. Never clear a sibling provider, another account, an unrelated capacity condition, or create an available row without a prior quota observation.

Use a conditional update matching the original capacity row identity, version, state and ownership. A newer observation or ownership handoff leaves its restriction intact. A missing or unverifiable owner leaves routing evidence unchanged. Existing legacy provider verification remains separate; this change does not broaden its account aliases or credential grants.

No new inference route, timer override, account activation, grant, credential store or database migration is introduced. Existing approval idempotency, bounded HTTP request, one token-renewal limit and completed-response validation remain in force. Reconciliation never retries paid inference.

The active-account `verificationOnly` path introduced in PR #6354 does not activate accounts or mutate quota; existing snapshot-bound credential renewal remains permitted. It validates the existing account snapshot without capturing or clearing quota evidence. Restoring routing uses the normal authorized account-verification path; a successful verification-only probe alone does not claim that routing was restored.

## Ordered repair and acceptance

1. **AC-Q1 / restored-allocation:** reproduce explicit default-account verification succeeding without clearing its own old quota row. Observe failure against the original handler.
2. **AC-Q2 / owner-isolation:** capture a linked selected-account row or verified unlinked default; refuse foreign owner, nondefault legacy access, mismatched default credential, missing credential and non-quota states.
3. **AC-Q3 / completed-response:** clear only after strict completed Responses evidence and successful connection/credential transaction; 401, 429, network failure, incomplete output and changed connection do not clear it.
4. **AC-Q4 / generation-fence:** match captured row identity/version/state/ownership. New failure, ownership handoff, deletion and duplicate completion preserve the current observation. A failed conditional update must not be described as restored routing.
5. **AC-Q5 / governed-delivery:** affected source tests, both web typechecks, required guards, immutable canonical gate, independent review, DCO PR and protected merge queue. Canonical deployment and a fresh governed account check establish live behavior; source tests and the earlier probe do not establish deployed repair.

Atomic deliverable `account-quota-reconciliation`, mapped to BI-38064739: ownership, completed-response ordering and conditional quota update must ship together. Contract references: `selected-account-ownership`, `responses-completion`, `capacity-observation-fence`. Flow references: `approved-account-verification`, `quota-routing-reconciliation`. Verification references: `explicit-default-red-green`, `owner-and-generation-failure-injection`, `canonical-exact-head`, `served-account-recheck`.

## Quoted delivery baseline

The following criteria are quoted from the existing BI-3CF78C8E acceptance baseline for immutable plan traceability. The output-fit design remains the owning design for AC-WIRE through AC-DELIVERY; this quota follow-through does not close broader calibration or erase outstanding native and live acceptance.

- AC-WIRE: Inspect the real adapter body for the supported numeric thinking allowance while preserving total max_tokens.
- AC-SUPPORT: Unknown, ambiguous, stale or unreadable backend/template evidence must not claim numeric effort support.
- AC-ENVELOPE: Activity allowances, invalid budgets, fixed provider thinking and fallback dispatch must preserve the authorized total.
- AC-JSON: Actual native review requests JSON; malformed, empty, reasoning-only or truncated output stays inconclusive.
- AC-RECOVERY: Preserve request identity, evidence, authority, deadlines, replay/expiry/cancellation/executor-loss and late-writer fencing tests.
- AC-QUALITY: Obtain a genuine complete native verdict and matched clean/defective completion controls with exact model/runtime/template/prompt/schema/tools/budgets; legitimate FAIL counts as verdict, one pair is not broad calibration.
- AC-DELIVERY: Record DCO source, independent exact-commit assessment, canonical gate, protected queue, canonical deployment and live verification; unavailable gates remain unrun.
- AC-Q1: Reproduce explicit account verification succeeding without clearing its own old quota, then verify the repair.
- AC-Q2: Reconcile only selected linked-account evidence or verified canonical-default legacy credential ownership; preserve foreign accounts and unrelated capacity states.
- AC-Q3: Require strict completed Responses output and successful selected-connection transaction; failed/incomplete probes must not clear quota.
- AC-Q4: Fence quota mutation by captured row identity/version/state/ownership; newer failure, handoff, deletion and duplicate completion preserve current evidence and report truthful status.
- AC-Q5: Deliver the quota repair through canonical tests, independent review, DCO PR/queue/canonical deployment and a fresh authorized live account check; verificationOnly cannot activate accounts or mutate quota and existing snapshot-bound token renewal remains allowed.

## Independent review follow-through

Native review `TR-GATE-259744AB2300F0399E800C65` genuinely completed with PASS for source `05b2f008efec7d14ca89e14ed79d1319224804ad`, receipt `cmv7po4170wjh01mn1zvto4r2`. Both reviewers used Claude CLI; this is platform review evidence, not local-model performance evidence. Important nonblocking findings are being resolved before publication:

1. Move the conditional availability write beside the existing canonical capacity writer and share its availability data construction. Import the canonical state/action/confidence/source contracts instead of defining free strings in the action layer.
2. Isolate a failed quota write using a PostgreSQL savepoint after the connection CAS and credential update. A recoverable quota error must retain authenticated state, avoid changing the captured restriction, report a local routing-update failure and send no further provider request. Its current routing state remains unconfirmed because another writer may have changed it. Failure to restore the transaction or commit remains a local persistence failure; a completed provider response must not be described as a provider rejection.
3. Add real PostgreSQL checks for nullable and named connection predicates, ownership handoff/version fencing, and recovery from a genuine SQL error. Mock predicate tests and the transaction-abort failure injection do not establish these database properties.
4. State the scope accurately: this recovery is for the OAuth/Responses path, not API-key or workload-identity verification. Canonical default credential plus name is a bounded inference for an unlinked legacy record; it does not reconstruct historical attribution.

[PostgreSQL savepoints](https://www.postgresql.org/docs/current/sql-savepoint.html) and [rollback to a savepoint](https://www.postgresql.org/docs/current/sql-rollback-to.html) preserve transaction work preceding the isolated operation. A plain JavaScript catch does not restore an aborted database transaction.

After canonical coordination returned, ordinary scope claims granted the store, type registry, existing store tests and PostgreSQL fixture. The conditional writer now lives beside the existing clear operation and shares its availability data factory. The paid-write failure test observed 17 passing tests and one failure before repair; the recovered behavior and existing boundaries pass 55 tests in four files. Both typecheck programs pass. Six real PostgreSQL cases are prepared but intentionally skipped outside a canonical leased database; their execution remains unrun until the shared gate. No review or gate receipt for this follow-through is inferred from the earlier PASS.

## Rollback and operational limits

Revert the scoped source PR through protected delivery if routing acceptance fails. Retain provider observations and audit evidence; never clear runtime rows by hand. A verified account may still be restricted by grants, data-use terms, billing or other provider failures. Old exhausted review lineages remain exhausted and are never renamed or restarted to manufacture assurance.
