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

### Connection and integration correction, 2026-10-11

The later availability check used the currently configured
`http://127.0.0.1:3000/api/mcp/v1?tier=full` origin. Its platform version endpoint
returned HTTP 200. The earlier `https://localhost` timeout proves that obsolete
endpoint was unreachable, not that the whole platform remains down. This chat's
tool catalog still exposes no native DPF tools; portal health does not prove
authenticated coordination, review or lease access. Subsequent use of the
repository's configured governed MCP transport returned the server's development
authority instructions and successfully loaded the independent-review tool.
The supported lease probe queued and released its temporary claim, proving gate
infrastructure is available; the outage bypass no longer applies. The combined
source passes 128 focused tests and both web TypeScript programs.
Do not substitute another
principal's credential or manufacture admission to get past that boundary.

Current-main integration found a generated doc-index conflict. Regenerating the
index from the merged source preserves both reliability and newer strategy work.
The newer absorption paragraph now refers to the owning investment allocation
instead of adding another unscoped ratio. Existing active execution-acceptance,
OAuth and tool-loop-repair chats own adjacent work; their source and runtime work
must be inspected before extending this slice. Do not start duplicate recovery
tasks merely because this chat cannot see their native tools.

### Explicit stop reasons, 2026-10-11

Founder direction requires every unfinished thread handoff to explain its
stop reason and the concrete question, owner action or external condition
needed to resume. The always-on rule lives in `AGENTS.md` section 10; the
[contributor procedure](contributor-procedure-runbook.md#ending-an-unfinished-thread)
defines the handoff procedure. This extends the existing governed-scope and
escalation principles instead of adding another decision store.

The review gate at source `3b364d6dc495` passed (evidence
`cmv48okve7nqz01p61pjije5r`, 4,216 tests passed, 14 skipped, 5 todo).
Both overlapping scope owners released their stale claims, and the native
full-scope claim succeeded. Independent review
`TR-GATE-7DCB905432CE2E5374C41A88` then parked without a verdict: canonical
portal logs reported no eligible confidential `build-review` endpoint.
Those facts do not establish publication or completion. This later guidance
edit changes the committed review identity; the prior gate must not be
represented as verification of the updated tree.
