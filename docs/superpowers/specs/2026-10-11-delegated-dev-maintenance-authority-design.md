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

Capture connection identity, owned credential id and updatedAt at execution entry. Token reads and refresh use this captured identity. Refuse changed ownership/revision/status before probing and before returning success. Renewal may update only the captured credential using one atomic compare-and-set conditioned on its refresh token and matching active install-owned connection revision. Both refresh success and expiry writes use that guard. A failed compare-and-set returns a changed-account error; it cannot overwrite a replacement credential or update another account. The existing OAuth token renewal remains the only grant exchange. Refresh cannot activate an account.

The small shared account-identity/verification helper and existing guarded renewal are the refactoring allocation. Keep classification and execution on that predicate; do not duplicate a DEV exemption in the escalation engine.

### Acceptance and ordered delivery

- AC-1: The exact already-active default ChatGPT/Codex DEV verification proceeds under existing delegation with no fresh human approval envelope; expiry is a connection failure.
- AC-2: Execution cannot activate inactive/disabled/disconnected accounts or modify another account after concurrent replacement/status change.
- AC-3: Production/unknown stance, missing grants/scopes, restricted data, consequential cases, new credentials and peer ownership keep their boundaries.
- AC-4: Classification, execution and concurrency regression tests plus source/typecheck, governed delivery and served DEV evidence are recorded honestly.

One atomic deliverable `active-account-verification`, mapped to BI-CFFB7ED7. References: requirement `AC-1`, contract `active-only-account-boundary`, flow `delegated-dev-verification`, verification `active-account-concurrency-regressions`.

1. Add classification and execution failures first: active default DEV ordinary, inactive/disabled/nonlocal/production unknown consequential; valid delegation automated, absent/restricted/consequential still human; successful probe never activates; replacement rejects; refresh compare-and-set refuses stale account/token.
2. Extend the existing refiner, shared predicate, verification-only internal path and guarded OAuth renewal. Preserve legacy behavior for other callers. Add no caller-controlled authority flag.
3. Update this canonical operation contract, tool description and human provider guide. Keep adjacent provider form ownership with BI-7AA4EB6B.
4. Run affected tests, production/test typechecks, deterministic guards, exact-head pregate, independent semantic assessment and protected PR/merge queue.
5. Advance only via canonical request_self_upgrade. Verify the exact DEV manage_provider_account test after feature-sha preflight; record no new approval envelope and actual upstream result. Source pass is not served proof.

Rollback restores the previous authority floor and ordinary test behavior; credentials and delegation are not reset. No schema migration, install asset edits, human impersonation or paired-production writes.

