---
status: active
backlog: BI-B22C8E02
---

# Delegated DEV maintenance authority

BI-B22C8E02 repairs routine calls that the server incorrectly treats as damaging.
The operator explicitly authorized emergency delivery and management of the
operator DEV install for development and testing on October 11, 2026 (America/Chicago).

## Evidence and existing architecture

Base: `f6d9e66eb0521cd2aeccf8a5ea4e7d902c7f9760`.
`apps/web/lib/mcp/packs/provider-account-tools.ts` declares every account operation
as `authority`; `admin-pack.ts` declares every command as `irreversible`.
The live backlog records an approved OAuth admin connection nevertheless parked
on model discovery and `docker compose ps --format json`.

On this base, `routine-maintenance-consequence.test.ts` ran with 7 failures and
27 passes. Discovery and five diagnostic calls retained the static consequence;
the connection-delegation test reached `human` instead of `automated`.
The negative cases passed: authority changes, shell compositions and unknown
commands retained their floor. This isolates classification from missing grants:
the existing escalation function permits an ordinary call with connection
delegation, and refuses the same call without steering. No prompt or environment
claim can manufacture that delegation.

Existing substrate: `resolveCallConsequence` narrows a declaration only to null
and fails closed on error. `connectionDelegationFor` and `resolveSteering` reuse
the human's current OAuth consent, scoped to the local MCP resource, acting
assistant and approved scopes. This is the operator-approved maintenance envelope;
it is already persisted, revocable and revalidated per request. A second DEV
delegation store would duplicate authority and introduce drift.

The WWMD consult DI-103A0F4AFBAA was incomplete because embedding retrieval was
unavailable; it is not authorization or a passing decision. This bounded repair
follows the explicit operator request and the existing commandment and refinement
contract. It does not depend on repairing the embedding provider.

## Operation contract

| Operation | Call consequence | Reason |
| --- | --- | --- |
| Account discover with explicit identity and no credential/configuration input | ordinary | Uses current credentials to synchronize catalog and account availability; profiling derives metadata without inference calls. No grant or clearance changes. |
| Account add/configure/enable/disable/sign-in/disconnect | authority | Changes account identity, credentials, activation or authorization. |
| Account test | authority retained pending the bounded active-account verification delivery below | Current implementation can activate an account and send an inference probe. BI-CFFB7ED7 separates those effects; its source delivery and served evidence must precede ordinary classification. |
| Unknown or incomplete account operation | authority retained | Fail closed. |
| Strictly parsed local Compose ps/logs and Git status/rev-parse diagnostics | ordinary | Single read operation on the current install; no alternate project/config, shell syntax or executable override. |
| Other commands | irreversible retained | Arbitrary scripts, mutation, unknown flags and shell composition remain on the existing controlled path. Existing destructive-command blocks remain. |

The diagnostic parser is shared by classification and execution. Recognized reads
run with executable plus argument vector, without a shell. This prevents the
approval refiner and executor from interpreting the same text differently.
The legacy command path retains its consequence and blocks. This extraction is
the scoped refactoring allocation; no unrelated cleanup is included.

## Ordered implementation and coverage

One atomic implementation owned by BI-B22C8E02, with this file as its canonical
fix plan. The documentation alone does not deliver the fix.

1. Add failing operation and delegation regression tests (reproduced above).
2. Add provider discovery refinement and shared strict diagnostic parser; execute
   recognized diagnostics without a shell. Keep grants, scopes and static
   declarations intact, including consult/receipt floors.
3. Explain routine delegation and remaining approval boundaries beside existing
   consent permissions and installation authority instructions. Reuse current
   disclosures and theme styling; add no permission control or new approval.
4. Run affected tests, authority/delegation negatives, typecheck, deterministic
   guards and the shared local-CI gate; obtain independent semantic review.
5. Publish the signed PR, pass cloud gates, merge through the queue, advance DEV
   through `request_self_upgrade`, then verify actual discovery and diagnostics
   over MCP without fresh employee approval.

## Acceptance and non-negotiable boundaries

- The two observed routine calls with valid delegated admin authority execute
  without a fresh approval envelope. Reversible maintenance already classified
  ordinary continues to use existing delegation.
- Missing/revoked/mismatched OAuth binding, missing grants or insufficient token
  scope cannot be repaired by a prompt, DEV identity or client-supplied argument.
- Real credential, activation and authority changes retain their consequence;
  restricted data, propose boundaries and consequential Work Cases still gate.
- Production gets no new delegation or relaxed policy. Correct operation
  classification applies consistently, with the existing local consent boundary.
- Paired-install records remain read-only. No teardown, credential replacement,
  direct database authorization edits, impersonation or hand-built live image.
- The connection screen and client briefing explain the delegation together
  with its scope and remaining restrictions. No new routine confirmation step.

No schema migration is required. Rollback reverts the refiners and parser; prior
consents remain valid, and static consequences restore the previous approval
behavior. Source tests alone do not prove the served install is fixed.
## Active DEV subscription verification — BI-CFFB7ED7

This section supersedes the earlier blanket account-test authority classification for the bounded case below. The live active default ChatGPT test raised approval cmv7e9ejz02yv01qszshw5ehx and, after approval, failed with upstream token_expired. Existing tests on83bc3de confirm test retains authority despite existing OAuth delegation. Research receipt initiative-e02a9da4-bb25-4e49-bae5-64aab18fa776 records the reproduction and60passing policy/delegation tests.

Reuse the current consequence refiner and connection delegation. No new store, grant, trust tier, approval switch or environment assertion. Blanket DEV exemption ignores actual effects; changing the approval wording does not remove the work. A bounded verification path separates checking an active account from enabling it.

### Effect boundary

Only identity-only tests of persisted install-owned canonical default ChatGPT/Codex OAuth connections, already active with an owned credential, refine to ordinary on persisted development/evolve-dpf. Existing capability, token/grant, connection-delegation, restricted-data and consequential-case checks remain.

Execution always applies verification-only behavior for those canonical default subscription identities, including production. It rechecks persisted account ownership, OAuth method and active status. It never invokes activation, writes account status, changes clearance or refreshes the catalog. An inactive account needs the existing explicit enable workflow. Unknown/missing identities, configuration inputs and other accounts keep the authority floor.

Capture the connection and its owned credential together at execution entry. Pin both updatedAt revisions and the encrypted cached/refresh-token values. Token reads and refresh use this captured identity. Recheck the joined snapshot immediately before every probe, including after model resolution and after renewal, and before returning success. Renewal may update only the captured credential using one atomic compare-and-set conditioned on its credential revision, refresh token and matching active install-owned connection revision. Both refresh success and expiry writes use that guard. Advance the in-memory credential revision only to the exact values this call itself successfully wrote; another writer still invalidates the next probe. A failed compare-and-set returns a changed-account error; it cannot overwrite a replacement credential or update another account. The existing OAuth token renewal remains the only grant exchange. Refresh cannot activate an account.

The small shared account-identity/verification helper and existing guarded renewal are the refactoring allocation. Keep classification and execution on that predicate; do not duplicate a DEV exemption in the escalation engine.

### Acceptance and ordered delivery

- AC-1: The exact already-active default ChatGPT/Codex DEV verification proceeds under existing delegation with no fresh human approval envelope; expiry failure is reported as a connection failure, not an approval question.
- AC-2: The execution path cannot turn inactive/disabled/disconnected accounts active or modify another account after classification, even under concurrent replacement/status change.
- AC-3: Production/unknown context, insufficient grants/scopes, restricted data, consequential cases, new credentials and peer ownership retain existing boundaries.
- AC-4: Regression tests exercise classification plus executed effects and concurrency; source/typecheck, governed delivery and served DEV evidence are recorded honestly.

One atomic deliverable `active-account-verification`, mapped to BI-CFFB7ED7. References: requirement `AC-1`, contract `active-only-account-boundary`, flow `delegated-dev-verification`, verification `active-account-concurrency-regressions`.

1. Add classification and execution failures first: active default DEV ordinary, inactive/disabled/nonlocal/production unknown consequential; valid delegation automated, absent/restricted/consequential still human; successful probe never activates; replacement rejects; refresh compare-and-set refuses stale account/token.
2. Extend the existing refiner, shared predicate, verification-only internal path and guarded OAuth renewal. Preserve legacy behavior for other callers. Add no caller-controlled authority flag.
3. Update this canonical operation contract, tool description and human provider guide. Keep adjacent provider form ownership with BI-7AA4EB6B.
4. Run affected tests, production/test typechecks, deterministic guards, exact-head pregate, independent semantic assessment and protected PR/merge queue.
5. Advance only via canonical request_self_upgrade. Verify the exact DEV manage_provider_account test after feature-sha preflight; record no new approval envelope and actual upstream result. Source pass is not served proof.

Rollback restores the previous authority floor and ordinary test behavior; credentials and delegation are not reset. No schema migration, install asset edits, human impersonation or paired-production writes.

## Guarded subscription renewal composition — BI-CFFB7ED7 completion integration

PR #6354 delivers active-account verification and ordinary DEV classification. Its merge is source evidence; the containing release and live verification remain required. The existing catalogue plan at `7eda246b0fc4b42e1bf60cd54a606e921955ac84` decomposes the shared service dependency to BI-CFFB7ED7 and retains caller/transport work in BI-59E37E39. This section extends the existing atomic `active-account-verification` deliverable rather than claiming the catalogue or UI deliverables.

`scoped-renewal-composition` preserves the public internal signature `refreshOAuthToken(providerId, connectionId, activeSnapshot?, scopedGuard?)`. The existing third argument stays in place; catalogue and routing supply `undefined` third and their raw captured scoped guard fourth. Neither metadata object is accepted from a browser or public MCP input. Reuse the existing OAuth exchange and account model; add no grant, credential store or persistent substrate.

`default-lineage-fence` allows both existing canonical default credentials to participate only after proving persisted install-owned null organization ownership, exact credential owners, non-disabled OAuth state, matching selected upstream identity and equal privately decrypted refresh lineage. IDs alone do not authorize another row. Additional accounts and unproven defaults remain selected-only. Token claims validate an already selected identity and never grant clearance. Retain the existing platform decision DI-5534D2F44975 and the approved account-design compatibility boundary.

`selected-refresh-dispatch` privately clones caller dates, owner fields and full encrypted credential revision before the first await. Check the selected joined owner and full credential revision immediately before HTTP for every guarded caller. The active-default predicate and caller cancellation must both hold when both guards apply. Validate response shape and selected upstream identity before writes, including unproven third-only defaults. Reuse/export the existing private token-identity parser for server callers rather than duplicating it.

Acquire every captured participant's owner lock in stable connection-id order, verify its full captured ownership/state under the lock, then conditionally write all captured credential revisions in one transaction. Include cached-token and refresh-token ciphertext as well as updatedAt. A failed second CAS, disabled/reowned/peer participant or cancellation rolls back the whole write; do not downgrade a captured pair after HTTP. Advance the active caller's credential revision only after commit to exactly this call's committed values. Preserve original active-only expiry behavior under the same captured active owner/revision; expiry affects only the selected row and cannot overwrite replacement credentials. Account activation, data-use permissions, trust, catalog proofs and pins remain untouched.

`paired-refresh-postgres-regressions` combines the existing guarded OAuth tests with a real Prisma/PostgreSQL fixture in a generated schema. It must prove paired success, second-write rollback, changed sibling refusal and owner locks against a concurrent update. Only an explicit SQL fixture or the governed local-CI slot database is eligible; no installed account rows are used. Skipped fixture execution is unrun, never atomicity evidence.

Ordered delivery: normal same-owner scope claim and impact/test resolution; immutable plan coverage; RED against the published predecessor; integrate the prepared service and preserve expiry compatibility; affected tests and both TypeScript programs; exact-source pregate and independent native review; DCO PR and protected queue; one existing canonical publisher; containing feature preflight and normal DEV saved-account verification. Source-local unit evidence does not qualify deployment. The catalogue owner updates its fourth-position raw-credential caller separately; the joint shared-default happy path stays an acceptance dependency until both sources and the containing runtime are qualified.

Preparation evidence only: the published predecessor fails 15 of 18 independent temporary tests; the repaired temporary copy passes all 18. The temporary PostgreSQL fixture, complete colocated suite, typechecks, native review and live integration are unrun. The scoped refactor consolidates captured owner/revision checks in the existing renewal service. Rollback reverts source, without resetting credentials or delegation. A rollback of the fourth-argument API must be coordinated with its dependent callers.

The immutable completion-integration plan coverage receipt is `cmv7pzcm714wf01obxilb2fef`, bound to published plan commit `3a66a33080b1e80a5c5fa64da962a6c2a509d03f` and blob `dec54679ac8d7966921c1a94521c68abf7c19be9`. It retains all four acceptance criteria and the existing atomic delivery. After integration, the actual source predecessor reproduced 15 failures and three passes. A further captured-sibling dispatch regression reproduced one failure and 22 passes before correction. Both default participants are now rechecked immediately before HTTP, and captured credential comparisons reuse the existing matcher. PostgreSQL qualification and served acceptance remain required.

An active verification must not reuse a token marked expired or whose decoded JWT expiry has passed merely because the stored expiry is future. Both cache regressions reproduced failures before correction. Reuse the same private claims reader for identity and lifetime hints; claims never confer authority, and opaque tokens retain the existing stored-expiry contract. Renewal still uses the captured owner and credential fences. This does not establish the cause of the observed metadata discrepancy.

Consumer review found a further renewal classification defect in the first qualified source candidate: HTTP 429/500/503 and unknown OAuth 400 replies could mark the captured credential expired or request reauthentication. Four new cases reproduced failures before repair. Guarded renewal now treats quota/server availability and unknown request failures separately, without credential writes. HTTP 401/403 and a recognized OAuth 400 invalid_grant retain the existing grant-refusal path and captured expiry fence. The predecessor gate and native receipt remain historical; the corrected commit requires fresh exact-source qualification.

