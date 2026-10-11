# Review reliability and aligned execution

## Objective and authority

Founder direction, 2026-10-11, prioritizes reliable execution through existing
review and recovery paths. Work is tracked in BI-06AE6833 and WC-0E8CF742 on
`fix/review-reliability-refactor`; consumer runtime files remain untouched.

[Absorb, Don't Adopt](../founder-kernel/wiki/principles/absorb-dont-adopt.md)
owns the investment policy: founder-funded shared platform work is 80%
refactoring, integration and reliability, 20% new capability until an explicit
maturity review. Organization and archetype defaults remain owner-scoped.
Funding owner and purpose determine applicability, not host or admin identity.

## Existing substrate and plan

1. Reuse a canonical task-bound immutable reviewer receipt before inference.
2. Share completion projection. Persist against observed status and timestamp,
   preserving cancellation, quiescence and newer attempts after a lost race.
3. Exclude writer refusals and exhausted inference budgets from automatic
   recovery. Retain eligibility filtering before the bounded oldest-first sweep;
   explicit replay can still settle an exhausted review from its valid receipt.
4. Share owner-scoped investment guidance across Build Studio and MCP hosts.
   Active principles link to the owning policy; dated specs remain historical.
5. Verify and publish through existing exact-head, independent review, DCO and
   PR gates. Unavailable or inconclusive gates never count as passed.

This slice adds no table, workflow engine, provider or dashboard. Versioned
investment policy and client evidence admission remain separate work.

## Conflicting and overlapping work

Before overlapping work proceeds, identify its owner, current direction, source
revision and existing plan. Reuse or explicitly supersede that plan, naming the
source that lost authority. The configurable investment design supplies the
owner/purpose distinction; its PlatformConfig revisions are not delivered here.
Existing replay scope repairs are retained rather than copied from older branches.
Both coordinated chat owners released stale overlapping claims before this
workroom's full scope was admitted. Live claims, rather than PR snapshots, govern
concurrent ownership. UNKNOWN skill loading is not authority to duplicate work.

## Evidence and recovery boundary

The configured governed MCP transport is reachable. An earlier timeout against
an obsolete HTTPS origin did not establish a platform-wide outage. Normal gates
apply; do not substitute principals or manufacture admission. Canonical workroom
evidence records verification by source identity; historical passes do not cover
later edits. Production build remains a merge-group CI obligation, and live
install acceptance must be reported separately.

[Contributor procedure](contributor-procedure-runbook.md#ending-an-unfinished-thread)
defines unfinished handoffs: state the stop reason, remaining work, next owner
action or external condition, and whether the human must act. AGENTS.md section
10 carries the always-on rule; a stopped chat does not imply background monitoring.

## Public development routing

Public source-only development can use ordinary provider accounts without
business-account or no-training evidence solely because it is code. Semantic
review uses the existing `development` route; the shared screener still raises
sensitivity for protected data and governed hints. The suitability compiler's
business-account requirement applies to non-public source; mixed workloads keep
the stricter profile. [Account-review guidance](../professions/legal-compliance/wiki/ai-provider-account-and-sovereignty-review.md)
owns that account distinction. Secrets, employee, tax and explicitly protected
source retain their protections.

Regression coverage includes receipt reuse without inference, terminal-state
races, bounded recovery, owner-scoped budgets, public review branches and protected
payloads. Synthetic sensitive fixtures can still trigger local-only screening.
If a complete review packet exceeds the eligible model's context, reduce repeated
narrative and unchanged diff context while retaining every changed line and its
immutable evidence bindings. Do not weaken screening, omit changes or invent a
review verdict to fit a provider. Submit once per immutable review identity.
