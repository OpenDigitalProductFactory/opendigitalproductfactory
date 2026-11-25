---
title: Software Platform pull request ownership
status: draft
backlogItem: BI-C3EBDCEC
---

# Software Platform pull request ownership

The Software Platform archetype provisions a [pull-request flow watch](../../../packages/storefront-templates/src/standing-rooms.ts). The inventory job can bind a provider observation to an existing Workroom. The delivery reconciler follows a bound PR and its code repair dispatcher requires a FeatureBuild. The standing room has no transition that assigns an owner to an unbound PR.

[PR #7180](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/7180) showed the gap. GitHub reported failing source policy guards and required Merge Readiness while no Workroom was visible for the PR. The room for [PR #7164](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/7164) remained live after GitHub closed that PR unmerged. An operator session retired the room after verifying that all six changed files matched the changes delivered in [PR #7179](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/7179).

This design applies the existing [PR convergence contract](2026-09-03-local-first-agentic-delivery-throughput-design.md#82-work-shape-evolution-and-encoded-boundaries) to the Software Platform standing duty. The [implementation plan](../plans/2026-11-24-software-platform-pr-ownership.md) sequences the change under BI-C3EBDCEC.

## Objectives

**OBJ-PR-OWN:** Every open PR on the managed repository has an accountable Workroom. Build Studio takes custody when the existing policy permits it and records who must act when it cannot proceed.

**OBJ-PR-REPAIR:** An eligible PR with failing checks reaches a bounded repair, protected merge, or an evidenced stop without depending on a chat session.

**OBJ-PR-CLOSE:** End PR-only custody from verified provider evidence while preserving undelivered work and recording the actual outcome.

| Acceptance | Objective | Statement |
| --- | --- | --- |
| AC-PR-1 | OBJ-PR-OWN | A complete sweep of open PRs on the managed repository leaves one live owning Workroom per PR, including a named owner and reason when a PR awaits authorization. Repeated and concurrent observations converge on the same custody. |
| AC-PR-2 | OBJ-PR-REPAIR | A same-repository dependency PR with a reproducible source-policy failure is repaired and merged through the protected queue on the live install without a chat session or manual takeover. |
| AC-PR-3 | OBJ-PR-REPAIR | A room remaining escalated across two sweeps has a recorded routeToHuman disposition. A cleared stop resumes on fresh evidence and an obsolete head cannot publish. |
| AC-PR-4 | OBJ-PR-CLOSE | A merged PR records delivered custody. A closed-unmerged PR ends eligible PR-only custody as undelivered, preserves source and evidence, and lets an independently observed replacement proceed on its own identity. |

## Custody and repair

1. Have the existing [inventory binding pass](../../../apps/web/lib/work-capsules/pull-request-binding-runtime.ts) match exact observations to active rooms first. Use the existing scheduled inventory job for the bounded backstop. Its recent `state=all` window is insufficient to prove coverage of old open PRs. Converge the open population through the same inventory source and carry an explicit completeness result. A failed or partial page, or an ETag response without a verified prior population, yields an unknown coverage result. An unavailable source cannot establish a PR’s absence or authorize closeout.
2. Use the standing duty as the accountable entry point and a finite Workroom for each PR occurrence. Update the Software Platform declaration to describe the provision. Preserve pinned watch versions and publish any changed shape through the versioned registry. Resolve the installation’s managed repository and delivery portfolio ownership through their existing resolvers. Match repository, PR number, exact head repository and ref, base branch, and head SHA before a write. Reuse a matching room with a live lease. Use the governed same-owner handoff for eligible lapsed custody. Make the Workroom binding and custody decision transactional with the existing branch identity fence. Neither a bot name in a branch nor an installed archetype supplies write authority.
3. Use the [existing delivery reconciler](../../../apps/web/lib/queue/functions/build-pr-delivery-reconcile.ts) and its current recovery budget. Give eligible PR-only rooms a dispatch route into the existing bounded Build Studio repair and review path. Record the PR and head, failed required checks and log references, effective authority, and attempt bound. A new head supersedes in-flight effects. A fresh authorized executor resumes the existing attempt after loss of capacity. Pending checks use no model execution. Keep fork and draft PRs visible with their applicable owner and next action. Use `routeToHuman` for blocked authority, genuine conflicts requiring a decision, and exhausted repair, with a stable key for the same subject and cause.
4. For an identified dependency bot, preserve the proposed package names and versions. Deduplicate the lockfile and refresh the disposition matrix from the resulting resolution when the existing dependency policy requires it. A proposed increase to the SBOM budget, new package, or change in dependency intent requires its existing policy path. Repair publishes a DCO-signed fast-forward follow-up on an authorized branch. Re-evaluate independent review and protection against the current head before requesting the merge queue.
5. Settle an exact verified provider outcome through the existing terminal transition. A merge records the delivered result. A closed-unmerged PR-only room can end as undelivered when no outstanding owned outcome or unmerged work requires further custody. Another PR with a similar branch or title remains independent. Closeout preserves evidence and delegates any cleanup to the existing worktree janitor with its normal proofs.

## Research and benchmarking

- The [BMAD evaluation](../../security/tool-evaluations/2026-09-15-bmad-method.md) documents explicit criteria and handoffs between delivery steps. Apply that separation to custody, repair, queueing and closeout, using the existing Workroom driver and durable receipts.
- [Prow Tide](https://docs.prow.k8s.io/docs/components/core/tide/) shows how to reconcile a repository-wide PR population and publish the missing requirement for each PR. Reuse the reconciliation and visibility pattern through DPF’s inventory and Workrooms. GitHub’s protected queue continues to own merge execution.
- [Renovate](https://github.com/renovatebot/renovate/blob/main/docs/usage/updating-rebasing.md) treats a maintainer’s follow-up commit as a reason to stop regenerating its branch. Take this as a custody boundary. DPF verifies the exact current head before repairing or publishing and keeps the bot’s dependency intent explicit.
- [GitHub merge queues](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) qualify the combined change against current base and other queue entries. DPF retains the provider verdict and distinguishes a request for auto-merge from admission and settlement.
- [Azure Repos branch policies](https://learn.microsoft.com/en-us/azure/devops/repos/git/branch-policies) re-evaluate preconditions when source or reviewer state changes. DPF binds its own evidence to the current immutable head before requesting the existing queue.

The implementation reuses Workroom, the contributor inventory, the provider observation and delivery jobs, and existing principals and review receipts. Deployment topology and public APIs remain outside the change. The Software Platform category is the activation boundary because its declared standing duty operates a source repository.
