---
status: active
---

# Verification recovery safeguards

Operator objective: implement safeguards observed during BI-CAP-437F7745, separately from canonical identity repair and BI-56E9CEC2 authority configuration.

## Current evidence and coverage

Source base: 4f5def81786 (origin/main). Live MCP reads identified BI-2641F34A for claim integrity, BI-9DC43E17 for delivery/readiness UI, and BI-8ECEC429 for expired infrastructure-inconclusive reviews. These are existing owners, not permission to duplicate or take over their work. BI-9DC43E17 has other live/resumable Workrooms.

MCP became unavailable during reconciliation: two governed reads returned transport failures against the configured endpoint. AGENTS.md recovery routing permits bounded authorized source repair and local tests with later coordination reconciliation. No Workroom, approval, coverage receipt or canonical verification has been fabricated. This plan is not implementation coverage.

## Bounded source repair

PR readiness does not consume CI change scope even though pregate already filters guards by declared inputs. Regression on the named base: scripts/pr-readiness-scope.test.mjs executes two tests, of which the AGENTS.md-only case fails because a code-only guard remains selected. Mixed/unknown changes retain all guards.

1. Reuse the existing guardAppliesToScope predicate rather than adding a competing classifier (relevant refactoring allocation).
2. Pass classifyChangedFiles(repo.changedFiles) to PR readiness's plan builder.
3. Test docs-only, mixed and unknown scope; retain guards without declarations and all applicable documentation guards.
4. Run relevant Node regression tests; no dependency-dependent gate is claimed on this source-only worktree.
5. Reconcile live backlog ownership, claim and plan coverage when MCP returns, before publication. Complete required publication, independent review and runtime gates without overriding authority or protections.

## Remaining objectives

Inspect automatic repository/branch/worktree/base/head validation; bounded checks with progress and persisted non-success outcomes; queued review resumption; canonical readiness blocker/owner/action projection; saved versus connection-effective identity readback. Existing Git Bash probing and pinned TypeScript runtime loading are present, but deployed verification remains unproven. Record confirmed gaps and dependencies against their existing owners. Reserve at least 20% effort for relevant consolidation/refactoring under the operator's explicit direction.

No deployment performed. Source delivery and deployed acceptance remain separate obligations.
