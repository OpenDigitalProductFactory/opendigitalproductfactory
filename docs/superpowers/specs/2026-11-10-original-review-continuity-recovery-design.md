---
status: active
---

# Correct refresh evidence identity in queued OAuth work

Backlog: BI-CAP-FD47D2C5. This is one atomic repair of an existing authority
lookup, its regression tests, and this explanation. It introduces no credential
issuer, reconciliation store, retry actuator, or new permission.

## Problem and evidence

At source `41afd6e6bb5bce14b3fd84068cdaac5a2e930402`,
`inspectOAuthExecutionAuthority` in `apps/web/lib/auth/oauth-tokens.ts` searches
for an eligible refresh token when an expired access token has no current
same-envelope access successor. Its query compares the refresh row's `agentId`
with the access row's `agentId`.

Those fields use different identity domains. `exchangeOAuthCode` passes the
semantic `Agent.agentId` to access issuance. `issuePair` passes
`agentRecordId` to refresh issuance; `OAuthRefreshToken.agent` in
`packages/db/prisma/schema/core-identity.prisma` references `Agent.id`.
`resolveOAuthConsent` deliberately returns both values. Equal human, client,
family, binding, resource, and scopes cannot make those different identifiers
equal.

A source-local synthetic experiment executed the actual authority function
with schema-correct refresh persistence. Valid refresh evidence returned
`continuity-evidence-missing`. Replacing only the refresh assistant comparison
with the existing Agent relation accepted that evidence. Missing evidence,
another assistant, and revoked access still failed closed. The existing three
affected unit files passed 66 tests; their refresh mock returned a row without
checking the persisted identity. Neither experiment establishes the cause or
settlement of a particular historical review.

## Required behavior

- REQ-CONT-ID: Resolve the refresh row's assistant through its existing Agent
  relation, comparing the semantic identity with the access actor.
- REQ-CONT-ENVELOPE: Keep the original human, OAuth client, consent binding,
  family, resource, scope containment, token eligibility and consent checks.
  Missing assistant identity must fail closed without a broad relation lookup.
- REQ-CONT-NO-REPLAY: Diagnosing or correcting this lookup must not dispatch,
  replace, cancel, reset, or rekey any review or invent continuity evidence.

Contract CONT-AUTH-1 is the existing `inspectOAuthExecutionAuthority` result:
`allowed: true`, or the first current typed refusal. Bearer authentication is
separate and remains unchanged. Contract CONT-PERSIST-1 is the existing
`OAuthRefreshToken.agent -> Agent.id` relation; access actors retain their
semantic identity. No schema migration or stored credential rewrite is needed.

## Ordered implementation

All steps below are internal sequencing for BI-CAP-FD47D2C5, not independently
shippable deliverables. One PR must carry the lookup, tests, and explanation.

1. VER-CONT-RED: Extend the colocated authority test with a schema-correct
   refresh record whose database id differs from its semantic assistant id.
   Make its lookup honor the supplied identity predicate. Confirm the current
   source rejects eligible evidence and the new acceptance assertion fails.
2. FLOW-CONT-REFRESH: Resolve only the refresh lookup through the existing
   Agent relation. Handle a missing access assistant explicitly and fail closed.
   Preserve successor-first ordering, family/client/user/binding/resource/scope
   filters, refresh consumption/revocation/expiry filters, and final live consent
   validation. Do not change issuance, credentials, or historical task state.
3. VER-CONT-GREEN: Run the regression and affected authority, credential
   lifecycle, and consent tests. Include negative cases for a different
   assistant, no refresh evidence, a missing access assistant, and invalid or
   revoked consent. Assert the complete refresh predicate so identity repair
   cannot erase another envelope boundary. Run the package typecheck and
   change-impact obligations in the governed exact-tree verification route.
4. VER-CONT-DELIVERY: Publish through the existing protected PR process, with
   source provenance and independent review. The release owner advances the
   canonical install. After deployment, use an authorized original-task reader
   to determine whether the particular blocked binding now has valid evidence.
   A continuing refusal is an unresolved recovery outcome, not permission to
   manufacture credentials or start another review.

## Impact, verification and rollback

The implementation touches the refresh evidence filter and its colocated tests.
It changes no routes, UI, grants, scope map, persistence model, or token issuer.
The existing OAuth execution tests, credential lifecycle tests, and identity
binding tests are the initial verification set; the edit-scope impact contract
may expand it. Runtime and full-build claims require canonical evidence.

The security risk is accidentally accepting another actor or weakening a family
boundary while fixing an identity mismatch. Exact query assertions and negative
behavior tests guard that risk. A source revert through a protected PR restores
the previous fail-closed behavior; no data rollback is required. Do not restore
expired credentials, edit signed runtime proofs, or bypass a live denial as a
rollback procedure.

## Completion boundary

The code repair is verified only after the real regression is red before the
change and green after it, affected tests and typecheck pass, required build and
review gates complete, and the immutable change is delivered. The original
recovery request additionally needs attributable evidence for its original
binding or an exact continuing authority refusal. A merged code repair alone
does not prove the wider standards programme is complete.
