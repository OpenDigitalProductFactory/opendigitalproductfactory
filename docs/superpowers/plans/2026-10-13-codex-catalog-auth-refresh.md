---
status: active
---

# Selected-account catalog token renewal — BI-59E37E39

Implementation is in progress under WC-B81E3ED2. All eight source/documentation
paths have normal nonforced custody and resolved impact. Implementation admission
IRD-0E80E106434A is allowed. Immutable atomic plan coverage
cmv7d8cny1wc601llmxowj2wb remains bound to the original published plan at
c666a33b98a9ed447689683d185167c60e291131.

## Objective and existing work

Extend OBJ-CODEX-CATALOG-LIFECYCLE in the existing
`docs/superpowers/specs/2026-09-08-codex-model-catalog-lifecycle-design.md`.
PR 6268 established remote provenance and last-good preservation; it did not
prove positive current inventory or desktop GPT-6.1 Sol parity. The broader
account disclosure deliverable stays with BI-7AA4EB6B.

Live coordinator evidence on served 08bb8e24d7f2a4120fc8757717298f0003d923db:
one selected provider-default-codex metadata discovery returned the generic
authentication-request error. Six account IDs, its last verified time, reviewed
posture and twelve discovered-model presence records were preserved. The exact
server-request method and a backend 401 were not retained; neither is established
by that generic error. Current installed CLI version remains unverified. The
unused generic version-command proposal was declined without execution.

The source transport rejects every method-plus-ID server request. The official
Codex 0.157 account protocol defines account/chatgptAuthTokens/refresh with an
unauthorized reason, nullable previousAccountId hint, and a response containing
accessToken, chatgptAccountId and optional chatgptPlanType. This documents a
protocol gap; it does not identify the live message that was rejected.

Primary reference:
https://github.com/openai/codex/blob/rust-v0.157.0/codex-rs/app-server-protocol/src/protocol/v2/account.rs

## Authority and custody

Existing human-authorized DEV repair, same BI and session. Root retains sole
publication/runtime coordination and selected-account live acceptance.
New design admission: WC-B81E3ED2 / IRD-2CADBDD8968B, delivery-medium@1.0.0.
Checkout: D:/DPF-worktrees/codex-catalog-auth-refresh, branch
fix/codex-catalog-auth-refresh, base e2469415bce8022ef728fdd0eac4d5c7d9e7072e.
Managed bootstrap reports compile-ready, pnpm 10.33.2 and zero ignored builds.

Normal path claim with commandId failed once with PostgreSQL void deserialization.
That is unrun infrastructure, not a command receipt or an authorization denial.
Own native readback established zero path effects. After the coordinator verified
the predecessor's four-path release, one normal nonforced claim succeeded through
the expressly supported API mode without optional commandId. All room, grant and
conflict checks remained active; the failed receipt-backed command stays failed.
Governance OAuth files still appear on WC-2E77F8E1. Their original
author/coordinator owns supported custody handoff.
No foreign forced claim, direct database mutation, runtime edit or new live
credential operation is authorized by this preparation artifact.

## Acceptance retained verbatim

- AC-1: Every successful authoritative subscription inventory uses shared persistence, presence reconciliation and auth-eligibility admission; errors and empty/malformed inventories preserve last-known-good state and do not claim freshness.
- AC-2: Only models present in the authoritative run are profiled, so absent/retired rows are not resurrected; two confirmed absences and runtime-refusal retirement remain intact.
- AC-3: Presence timestamps change only on actual sightings, not missed-discovery bookkeeping; existing lifecycle fields are reused unless steward proves a migration necessary.
- AC-4: Connections separates connection, inventory freshness and workload restrictions; model count never equates historical profiles with usable models; technical inventory is disclosed under existing UX design.
- AC-5: Tests cover new model arrival without source edits, removals/relisting, failure/empty response, stale pins, auth admission, pricing/metadata preservation and prior readiness behavior; served verification uses canonical runtime.

## Atomic implementation flow

FLOW-SELECTED-RENEWAL: prepare the explicit selected credential and immutable
provider/connection/credential/upstream identity, authenticate the private CLI,
handle at most one valid host renewal request, then admit only existing remotely
verified nonempty inventory. Transport never decrypts credentials or selects a
provider default. The caller owns renewal through the existing OAuth service.

CONTRACT-DEFAULT-LINEAGE: preserve the existing compact shared default sign-in
only after proving both persisted default connection/credential owners, the same
already selected upstream identity and equal internally decrypted refresh-token
lineage. Default IDs alone are insufficient. Capture both owner and credential
versions before HTTP; validate the returned identity; acquire owner locks in
deterministic order and save both credential versions atomically. A changed,
disabled or reowned captured participant aborts the whole paired write. Preserve
account status, trust, proof and pins. Additional accounts and defaults with
unproven lineage stay selected-only, with truthful independent recovery.

This compatibility amendment follows platform decision DI-5534D2F44975
(high-confidence proceed; usable/autonomy-eligible; no commandment conflicts).
It preserves the operator-approved multi-account design's default compatibility
and current OAuth finish/shared-refresh semantics without treating provider names
as lineage evidence. No live pair identity equality has been established.

CONTRACT-SELECTED-RENEWAL: only the documented method/reason and the selected
ChatGPT auth type qualify. A foreign hint, unknown method, malformed request,
overlap or repeated request fails closed. A nullable upstream hint never grants
permission to change accounts. API keys never enter this renewal flow.

CONTRACT-RENEWAL-LIFETIME: the existing collector deadline owns the complete
attempt. Renewal is aggregate-budgeted once; it cannot reset the deadline or
pagination budget. Timer, child close, input-stream error or invalid competing
request ends the attempt. Late resolve/reject continuations observe settled and
current request identity; they neither write to closed stdin nor admit a cached
catalog. Pending callbacks receive cancellation/deadline context.

CONTRACT-CREDENTIAL-WRITE: reuse refreshOAuthToken, with a narrow optional guarded
path if required. Validate a returned upstream identity before persistence and
conditionally fence the credential update to its observed explicit connection,
provider, credential owner and current credential version/refresh token. An owner
change, disabled account or mismatch cannot mutate the foreign credential. An
explicit additional-account renewal cannot fall back to or synchronize a sibling
credential. Proven legacy defaults use CONTRACT-DEFAULT-LINEAGE. Existing
legacy renewal behavior remains covered separately. No HTTP implementation is
duplicated and no table, cache, model-ID list, SDK upgrade or UI control is added.

CONTRACT-CATALOG-PRESERVATION: private cache proof, per-page correlation, raw
metadata hashing, pagination bounds and last-good catalog/pin/presence semantics
remain intact. Token renewal is not catalog freshness or data clearance.

Ordered steps:
1. Resolve actual source custody, prospective impact and affected tests. Commit
   this plan at its final repository path and record atomic native coverage before
   implementation admission; keep the immutable plan identity.
2. Add failing source regressions for valid selected renewal and the lifetime,
   identity and guarded-write refusals below. Preserve the original foreign-account
   request refusal. Actual RED results are required.
3. Consolidate selected-account snapshot/read/compare logic, wire the optional
   caller-owned renewal and protect current attempt/stream lifecycle. Keep the
   existing protocol and OAuth service as single owners; roughly 20% of the work
   consolidates existing repeated auth/lifecycle checks.
4. Run the affected source tests, both web TypeScript programs, normal signed
   hooks and policy guards. Freeze and independently assess the exact source.
5. Publish only through governed DCO/PR/protected checks/merge queue. Existing
   scoped local-gate override and internal-review waiver are recorded as unrun,
   never passing native review or integration evidence.
6. After qualified containing deployment, Root performs one selected metadata
   discovery. Record positive remote proof separately from negative preservation.
   A failed result leaves the issue open and routes its sanitized cause category.

All steps are one deliverable. A transport callback without scoped credential
fencing is unsafe; fencing without the callback cannot handle the protocol; either
without lifetime tests can continue after the attempt ends. None is independently
shippable. This work does not close the broader account UI or original model-parity
acceptance merely by merging.

## Intended source scope

- apps/web/lib/routing/codex-cli-model-catalog.ts and its test
- apps/web/lib/inference/codex-cli-catalog-auth.ts and its test
- apps/web/lib/govern/provider-oauth.ts and its test, only after existing custody
  handoff and impact expansion, if required for the guarded write
- existing catalog lifecycle specification and this final repository plan

The shared OAuth pair also has successful normal scope claims. Production changes
reuse its HTTP renewal path, share selected-connection comparison, validate the
returned identity before saving, lock the selected owner during persistence and
conditionally update the observed credential version and refresh token.

## Executed evidence and remaining work

The initial three-file regression run executed 11 new failures and 78 existing
passes. The first repaired snapshot passed all 89 tests. That is predecessor
evidence: later lifetime and login-stage coverage changed the candidate.

Small source-only probes execute the exported runner/transport with simulated
processes and files. They observed and corrected four boundaries: two forwarded
frames after inner input failure became zero; renewal during login changed from
zero calls to one while catalog admission still waited for login; malformed
request IDs changed from one renewal to zero; a null RPC frame changed from a
stream-handler exception to a controlled discovery failure. Colocated regressions cover these
behaviors. These probes do not establish remote or served behavior.

The expanded regular suite and official web production/test TypeScript attempts
stopped before execution on repeated Windows host inventory JSON reader failures.
Their original B77A8C22E9/B2DDC061CF attempts remain historical infrastructure-unrun;
the existing verification-safeguards owner is repairing that execution path.
The changed source needs normal fresh admission and executed final checks before
independent assessment, publication and qualified live discovery. The case remains
open.

## Verification matrix

VERIFY-RENEWAL: valid documented request returns one refreshed selected login;
null hint remains selected; refreshed inventory still needs private remote proof.
VERIFY-IDENTITY: foreign hint, different returned upstream account, API key,
changed provider/connection/credential owner, disabled account and malformed token
fail before cross-account writes or admission.
VERIFY-LIFETIME: renewal resolving/rejecting after timeout, close, stdin error or
another server request cannot write or publish; repeated requests cannot renew
again; slow renewal remains inside the original deadline.
VERIFY-PERSISTENCE: returned-token validation precedes persistence; conditional
write loses cleanly to an ownership/credential change; additional-account renewal does not
touch sibling rows, trust, model proof or pins. Existing legacy tests remain.
VERIFY-DEFAULT-LINEAGE: both explicit default routes preserve proven legacy
shared sign-in. Missing owners, different upstream identity, unequal refresh
lineage, a disabled sibling or changed captured versions never copy credentials.
Acquire locks in stable order; failure of either CAS rolls back both writes.
Additional accounts remain selected-only. Masked expiry/status and default IDs
are not lineage proof; unproven shared recovery is disclosed truthfully.
VERIFY-CATALOG: current provenance/parser/pagination/privacy/empty/failure tests
and affected account discovery/revalidation tests pass without fabricated limits,
timestamps or models. Source fixtures are not remote/runtime evidence.
VERIFY-LIVE: exact deployed identity and normal operation precede Root's single
metadata-only selected discovery; successful fresh account inventory and preserved
negative behavior are separately recorded. No paid inference, provider activation,
pause alteration or live credential change is undertaken during preparation.

