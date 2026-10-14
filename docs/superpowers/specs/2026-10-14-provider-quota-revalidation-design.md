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

The active-account `verificationOnly` path introduced in PR #6354 remains read-only for authentication and capacity. It validates the existing account snapshot without capturing or clearing quota evidence. Restoring routing uses the normal authorized account-verification path; a successful read-only probe alone does not claim that routing was restored.

## Ordered repair and acceptance

1. **AC-Q1 / restored-allocation:** reproduce explicit default-account verification succeeding without clearing its own old quota row. Observe failure against the original handler.
2. **AC-Q2 / owner-isolation:** capture a linked selected-account row or verified unlinked default; refuse foreign owner, nondefault legacy access, mismatched default credential, missing credential and non-quota states.
3. **AC-Q3 / completed-response:** clear only after strict completed Responses evidence and successful connection/credential transaction; 401, 429, network failure, incomplete output and changed connection do not clear it.
4. **AC-Q4 / generation-fence:** match captured row identity/version/state/ownership. New failure, ownership handoff, deletion and duplicate completion preserve the current observation. A failed conditional update must not be described as restored routing.
5. **AC-Q5 / governed-delivery:** affected source tests, both web typechecks, required guards, immutable canonical gate, independent review, DCO PR and protected merge queue. Canonical deployment and a fresh governed account check establish live behavior; source tests and the earlier probe do not establish deployed repair.

Atomic deliverable `account-quota-reconciliation`, mapped to BI-38064739: ownership, completed-response ordering and conditional quota update must ship together. Contract references: `selected-account-ownership`, `responses-completion`, `capacity-observation-fence`. Flow references: `approved-account-verification`, `quota-routing-reconciliation`. Verification references: `explicit-default-red-green`, `owner-and-generation-failure-injection`, `canonical-exact-head`, `served-account-recheck`.

## Rollback and operational limits

Revert the scoped source PR through protected delivery if routing acceptance fails. Retain provider observations and audit evidence; never clear runtime rows by hand. A verified account may still be restricted by grants, data-use terms, billing or other provider failures. Old exhausted review lineages remain exhausted and are never renamed or restarted to manufacture assurance.
