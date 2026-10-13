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
| Account test | authority retained | Current implementation can activate an account and send an inference probe. Narrowing it needs a separate effect contract. |
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
