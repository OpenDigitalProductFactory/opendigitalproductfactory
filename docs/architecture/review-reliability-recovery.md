# Review reliability and aligned execution

## Objective and authority

Founder direction, 2026-10-11, authorizes bounded source repair while the DPF
platform is unavailable. The recommended approach consolidates existing review
and recovery paths. Source base: `9f95f3c9b7a`; topic branch:
`fix/review-reliability-refactor`. Installed runtime files are not changed.

Founder-funded shared platform investment is 80% refactoring, integration and
reliability repair, 20% new capability until an explicit maturity review changes
it. [Absorb, Don't Adopt](../founder-kernel/wiki/principles/absorb-dont-adopt.md)
owns the policy. Funding owner and purpose determine scope; organization and
archetype policies are not overwritten by host identity or an admin token.

## Existing substrate and plan

Existing specs/plans reviewed: the owner-scoped investment balance design dated
2026-09-27 and the native review/background recovery implementation. Existing
code inspected: `mcp-task-review-outcome`, `mcp-task-attempt-state`,
`mcp-task-background-dispatch`, `mcp-task-submit`, and `platform-dev-policy`.

1. Reuse the exact task-bound immutable native writer receipt before inference.
2. Share completion projection and condition persistence on the observed status
   and timestamp. Preserve cancellation, quiescence and a newer attempt.
3. Reject automatic inference recovery after an exhausted writer budget or a
   recorded writer refusal. Retain the bounded periodic sweep's eligibility
   filters so unhealable old waits cannot consume its entire oldest-first batch.
   Explicit replay can settle an exhausted review from its valid receipt.
4. Inject one shared owner-scoped investment guidance into Build Studio and MCP
   host instructions. Replace stale active kernel budget references with links.
5. Verify affected tests and source typechecks, then deliver through the existing
   DCO, independent review and PR gates. Unavailable gates remain unrun.

This slice introduces no table, workflow engine, provider or dashboard. Existing
task inspectors consume the persisted status and summary. Configurable budget
revisions, wider review-packet redesign and native-client evidence admission
remain separate work; this guidance does not enforce token quotas or grant funds.

## Conflicting and overlapping work

The active architecture and cleanup principles still named 20% while the newer
absorption and UX directions named 80%. The former now point to the owner-scoped
policy. Historical dated specifications retain their historical figures.

The `scoped-investment-balance` worktree holds an earlier configurable policy
design. This slice reuses its owner/purpose distinction; it does not claim to
deliver its PlatformConfig revision system or supersede that implementation.
The `review-replay-scope-repair` branch also changes `mcp-task-submit` for replay
packet/capacity scope. Comparing its affected implementation files with this
branch's source base shows those changes are already present; they are retained.
The `reviewer-gate-specific-recovery` branch addresses review request construction
and recovery selection; this slice reuses receipts after construction. Its older
request implementation differs from the current base; do not copy it wholesale.
The open-PR snapshot on 2026-10-11 contains dependency updates and mobile site
location work, with no review-reliability PR. A snapshot is not a work claim.

Before conflicting work executes, identify owner, current direction, source
revision, existing plan and overlapping branch. Reuse or explicitly supersede
the existing plan, and state which source lost authority. Skill installation
does not prove active loading; retain honest UNKNOWN readiness until the client
supplies evidence. Neither a stale instruction nor a skill-load warning grants
authority to duplicate or bypass the governed path.

## Evidence and recovery boundary

Regression observed: a seeded valid receipt still invoked the model before the
pre-inference guard. The corrected path invokes no model. Conditional persistence
tests cover terminal/quiescing states and a lost compare-and-swap race.
Initial combined verification: 127 tests passed across nine affected suites.
Supplemental verification: 46 tests passed across six suites, including approval
recovery and owner-scoped instruction coverage (some overlap the initial run).
Web source typecheck and test typecheck passed. All 14 local deterministic gates
passed after adding the seed-fit and upgrade-convergence declarations.

MCP coordination, runtime build/served workflow acceptance and independent native
review are unrun while the platform is unavailable. Do not deploy this branch or
report those gates passed. On recovery, reconcile existing backlog coverage
BI-06AE6833, BI-31159978 and BI-0ACB97B5, claim the live workroom, attach the source
and test evidence, execute the remaining gates and obtain the exact-tree review
receipt before opening a ready PR. No backlog status is asserted from offline
source evidence.
