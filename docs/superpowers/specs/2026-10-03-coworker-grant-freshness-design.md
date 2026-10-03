---
title: Apply coworker grant changes on the next authorization read
date: 2026-10-03
status: draft
backlog: BI-F2F09597
---

# Apply coworker grant changes on the next authorization read

## Problem and evidence

BI-F2F09597 extends the Capabilities editor contract in
[coworker management consolidation, section 5](2026-06-26-coworker-management-consolidation-design.md).
On the canonical install at `37da678752014212c7713ec7079716454b57284b`, an operator-authorized
temporary `admin_read` grant to `AGT-EXT-CODEX` persisted in the editor, but MCP
`load_tools(admin_view_logs)` still returned `agent-grant-missing`. The temporary grant
was removed and the original 14 grants verified. WC-82C41B53 holds the receipts.
The HTTPS reverse proxy and port 3000 route to the same portal container; the
MCP profile confirms the same coworker identity. No restricted log access occurred.

At that revision and base `0ada52b55865140f5e5c0bab01eec4ad33ea4fdb`,
`getAgentToolGrantsAsync` returns a process-global Map before querying
`AgentToolGrant`. Neither grant writer invalidates it. The same Map also accepts
synchronous registry reads. A zero-grant row and a failed database read both fall
back to registry grants. These paths can miss both additions and revocations.

## Authority and scope

The existing `AgentToolGrant` rows remain the authority for a stored coworker.
Every asynchronous runtime lookup reads them afresh. An empty set stays empty.
An unsuccessful authoritative read returns no grants. Registry fallback remains
only after a successful lookup finds no stored agent, preserving the existing
not-yet-migrated registry contract. Static registry callers retain their API but
cannot seed runtime authorization state. No new table, credential, tool, grant,
role, cache service, dependency or migration is introduced. Token scopes, user
capabilities, clearance, room admission and self-grant restrictions stay enforced.

## Research and alternatives

[OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
requires permission validation on each request and denial by default. Apply that
to the existing resolver. The installed Next.js caching guide also distinguishes
explicitly cached values from reads that must be fresh; route revalidation cannot
invalidate an unrelated module Map.

Remove runtime grant caching rather than add a TTL or writer-local invalidation.
A TTL leaves a revocation window; local invalidation misses separately bundled
routes and processes. A distributed invalidation substrate adds machinery when
the existing database lookup suffices. Keep static registry lookup behavior separate.

## Acceptance contract

- AC-1: A warm resolver observes a saved grant and its later revocation on the next lookup without reconnecting or restarting any process.
- AC-2: A stored coworker with zero grants receives no registry grants.
- AC-3: A synchronous registry lookup does not override stored grants.
- AC-4: A failed authoritative read returns no grants, including after a previous successful grant; the next successful read recovers normally.
- AC-5: Only a successful missing-agent lookup uses the legacy registry fallback.
- AC-6: After canonical deployment, the authorized temporary grant/check/revoke sequence succeeds through supported UI and MCP, and original grants are restored.

## Ordered fix plan

1. Reproduce AC-1 through AC-5 in `agent-grant-freshness.test.ts`, using the real
   grant mutation functions and an in-memory database mock. Record failing output
   against the unchanged resolver. This is research, not live authorization evidence.
2. Remove the asynchronous resolver's dependence on the process cache; distinguish
   absent rows from empty grants and database errors. Preserve the static API.
3. Run the regression, existing grant/core tests, MCP listing/route tests and web
   typecheck. Update the authorization runbook to describe immediate grant effects
   and fail-closed database errors. No UI layout changes are needed.
4. Commit with DCO, perform required independent review and integration gates,
   publish a ready PR and use the merge queue. Deploy only through canonical
   self-upgrade; verify AC-6, then resume BI-B8142BB4 diagnosis.

The resolver, regression and runbook form one atomic defect correction, owned
by BI-F2F09597. The upstream room admission implementation stays in BI-B8142BB4.
The related diagnostic capability request BI-CAP-D00B3FB6 does not repair grant
freshness. This also differs from per-person OAuth revocation BI-0A724798 and
initial roster grant provisioning BI-728FD7F2.

## Compatibility and verification limits

Existing stored grants, including explicit empty sets, take precedence over seed
defaults. During a database outage, tools requiring coworker grants are unavailable;
the next successful request recovers. Each lookup adds an existing indexed query.
If later measurements justify caching, revocation consistency must be proven
across processes before introducing it. No runtime restart or direct grant write
is an acceptable substitute for the source repair. Source-local tests cannot
establish live grant propagation; AC-6 remains required after installation.

## Live acceptance follow-up: edit the bound external authority

PR #5986 fixed stale reads, but AC-6 failed at canonical SHA
`c578984092dfe48c7ee94f3ee155636674817bba`. A second live probe showed that
Capabilities edited the `external-codex` runtime row (15 grants after reload),
while the OAuth connection's self-profile read `AGT-EXT-CODEX` (14 grants).
The temporary grant was revoked and the original counts restored. The source
trace is `loadCoworkerRecord` → `record.runtime.id` → `CapabilitiesEditor`,
versus OAuth consent's canonical Agent binding and the exact-identity MCP reader.

### Design grounding

Keep the existing consent authority established by
[OAuth external build authority](2026-09-21-oauth-external-build-authority-design.md).
`eligibleOAuthCoworkers` excludes dual-seed mirrors; legacy token identities are
not interchangeable authority bindings. `AgentToolGrant` and its durable
revocation tombstones remain unchanged. The executable runtime record still owns
skills and embedded execution. The detail read model must distinguish that
execution identity from the grant authority being managed.

WWMD decision **DI-612774F1F871** selects the proportional correction with high
confidence: use the canonical record for the approved external development
roles' permission editor, and preserve the existing runtime record for ordinary
embedded coworkers. Reuse the source-approved external role list; do not add a
second list. No token rebinding, grant union, mirror writes or migration. Broader
identity consolidation would change existing credential permissions and belongs
to a separately governed migration. The initial unscored decision
DI-25A1662E66CE supplied no usable recommendation and is not authorization.

### Additional acceptance

- AC-7: All approved external development roles display and mutate canonical OAuth Agent grants even when legacy runtime grants differ; counts, coverage, and editor use the same authority.
- AC-8: Skill assignment still targets runtime business identity, and ordinary embedded coworker grant editing still targets its executable runtime record.
- AC-9: Grant and revoke through the corrected editor target the same row checked by MCP; revocation tombstones, manage_platform guard, token scope and human capability intersection remain intact.

### Ordered follow-up plan

1. Add a read-model grant authority facet, selected from the canonical external
   role or ordinary runtime record, using the existing approved role contract.
   Give the editor separate grant-authority and skill-runtime identifiers.
2. Bind displayed counts, held grants and external service readiness to that
   same grant authority. Revalidate the canonical route after edits; skill
   actions retain the runtime business identifier.
3. Test deliberately divergent canonical/runtime grant fixtures for all approved
   external roles, zero canonical grants, ordinary embedded coworkers, editor
   grant/revoke target and skill assignment target. Re-run grant freshness,
   revocation, OAuth eligibility, component tests and web typecheck.
4. Update the authorization runbook, obtain independent review, run the governed
   integration gate, publish and merge through the queue. Coordinate canonical
   deployment with its current owner, then repeat AC-6 and restore baseline
   grants. Only a passing live receipt clears the original room-recovery gate.

The follow-up is an atomic correction of BI-F2F09597's failed AC-6. Read-model,
editor wiring, tests and operational documentation have no independent delivery
value. Existing authorization and data contracts remain unchanged.
