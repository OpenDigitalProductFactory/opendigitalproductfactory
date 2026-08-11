---
title: DCO Sign-Off Required on Every Commit
pageKind: principle
status: published
abstract: Every commit carries a Signed-off-by trailer attesting to the Developer Certificate of Origin.
principleTier: commandment
principleDirection: Sign every commit with the Developer Certificate of Origin trailer.
principleDimensionVector: {"governance_compliance": 1.0, "public_safety": 0.7, "evidence_density": 0.4}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
principleConsumerArchetype: universal
principleConsumerContexts:
  - engineering-flow
principlePublic: true
principlePublicRationale: DCO compliance is a public-facing licensing signal — adopters and contributors need to know the platform enforces it on every commit, no exceptions.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

Every commit carries a `Signed-off-by:` trailer attesting to the Developer Certificate of Origin. Use `git commit -s` (or `--signoff`) on every commit you author or co-author. The DCO bot blocks merge until every commit in the PR has the trailer; there is no admin bypass.

## Why

The DCO is the platform's contribution licensing chain. Without the sign-off, DPF cannot accept the contribution because there's no recorded assertion that the contributor has the right to license the work under the project's terms. This is not a hypothetical risk — it's a contract enforceability question that arises the moment a downstream user adopts the platform and asks about IP provenance. Skipping DCO sign-off creates a downstream cleanup task (rewriting commit history, re-attesting, re-merging) that is exponentially more expensive than typing `-s` once per commit.

## Applies To

In-platform coworkers (Build Studio's authored commits), external coding agents (Claude / Codex commits use the maintainer's `git config` identity and so inherit the sign-off discipline), and humans. Symmetric. Applies to every commit including documentation, configuration, dependency bumps, and reverts.

## How To Apply

The mechanical step is `git commit -s -m "<message>"`. The DCO bot checks every commit in a PR and surfaces failures with a link to the certificate text. When you forget — and you will, eventually — fix it by rewriting the unsigned commits: `git rebase --signoff <base>` adds the trailer to every commit since `<base>`, then force-push. Don't merge-bypass; the bot is right and the alternative is a downstream audit problem.

The bot runs *after* the push, so a missing sign-off — classically a corrupted or auto-generated MERGE commit — otherwise turns the PR red minutes later. The pre-push gate now catches it host-native, before the push leaves the worktree: `.githooks/pre-push-gate` runs `scripts/pre-push-dco-check.mjs` (`pnpm dco:check`) over `origin/main..HEAD`, merges included, and refuses the push if any commit lacks the trailer. Same predicate as `pnpm pr:ready`. See [`docs/architecture/build-gate-runbook.md`](../../../architecture/build-gate-runbook.md) for the full gate wiring.

## Decision Dimensions

- `governance_compliance: 1.0` — DCO is the licensing chain. Maximum weight.
- `public_safety: 0.7` — adopting the platform with a clean DCO chain is the safe path; adopting a project with broken sign-off is a known liability.
- `evidence_density: 0.4` — the sign-off trailer is durable per-commit evidence that compliance auditors can verify with no platform access.

## Examples

- **Positive:** Every commit in a feature branch carries `Signed-off-by: Mark Bodman <markdbodman@gmail.com>`. The DCO check passes on PR open; review proceeds; merge happens.
- **Counterexample:** Three commits in a fix branch are missing the trailer. The DCO bot blocks the PR; the contributor runs `git rebase --signoff main` and force-pushes; the bot re-runs and unblocks. The cost is one rebase; the cost of merging without the fix would be a downstream audit problem months later.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
