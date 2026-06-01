# Recommended PR Process & Prompt for Consistent DPF Contributions (including Grok Epic)

This document consolidates the canonical process from skills + observed high-quality patterns from recent PRs (as of 2026-05).

## Canonical Skills (Use These)

1. **dpf-finishing-a-development-branch** — Decide integration shape first (one PR vs stack vs split by concern). Confirm branch is green, sweep uncommitted/overlapping work.
2. **dpf-pr-with-dco** — The actual mechanics: branch from origin/main, every commit `-s` DCO, push, overlap sweep, open PR only when ready to merge.

These live in the DPF skill pack and are the single source of truth.

## Observed Real-World Patterns from Recent High-Quality PRs

Recent PRs by the primary maintainer (e.g. #1399, #1401, #1393, etc.) are richer than the minimal template:

- **Title convention**: `type(scope): imperative description (BI-XXXX / EP-XXXX part N)`
  - Examples: `doc: worktree is source-control isolation... (BI-979B0FE8 / ...)`, `feat: add BI-166C59F3 local-CI pregate`

- **Body structure** (more detailed than the basic template):
  - ## Summary (often starts with a quoted "Founder rule" or key insight from retrospective)
  - ## Canonical home (link to new kernel principle or spec/plan)
  - ## What changed (detailed breakdown, sometimes a table of files/agents)
  - Execution evidence table (multi-stage agent workflows, number of edits, verification counts)
  - ## Related BIs (with descriptions)
  - ## Verification (explicit "source-only" vs "runtime-bound" + harness limitation acknowledgment when relevant — per the new doctrine in #1399)
  - ## Test plan (checkboxes + actual commands run, including `pnpm security:secrets:staged`, specific vitest suites, docker compose checks, etc.)
  - Overlap sweep note: "`gh pr list --state open --limit 50` returned no open PRs."
  - Often ends with: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`

- Heavy emphasis on:
  - BI / epic linkage
  - Plans and specs as single source of truth
  - Explicit evidence of *how* the change was produced (agent workflows, grep verification, etc.)
  - The new tiered dev-loop / worktree isolation rules (source-only vs runtime-bound gates)

## The Minimal Official Template

See `.github/PULL_REQUEST_TEMPLATE.md` for the baseline:

```
## Summary

## Changes

## Test plan
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm --filter web build`
- [ ] Manual verification (describe below)

## Related issues

## Notes for the reviewer
```

High-quality PRs expand this significantly.

## Recommended Prompt for Future PRs (Copy-Paste Ready)

Use this when you (or an agent) are ready to open a PR after using the finishing skills:

```
You are preparing a DPF pull request for the [Grok first-class support / EP-GROK-001] epic.

Follow these rules strictly:

1. Use the process in `dpf-finishing-a-development-branch` then `dpf-pr-with-dco` skills.
2. Every commit must be DCO-signed (`-s`).
3. Base on `origin/main`.
4. One concern per PR.
5. Open the PR only when the branch is green and ready to merge (not as a parking place).
6. Perform overlap sweep before pushing.

PR Title format: `type(scope): imperative summary (BI-XXXX / EP-GROK-001)`

PR Body must include at minimum:
- ## Summary (start with the key insight or "Founder rule" if applicable; reference the design spec `docs/superpowers/specs/2026-05-31-grok-first-class-support-design.md`)
- ## Changes (bulleted, skimmable)
- Detailed evidence section (what was verified, commands run, links to plans/specs)
- ## Test plan with checkboxes + actual commands (include typecheck, relevant vitest, security scan, and any runtime-bound notes using the new worktree-is-source-control-not-runtime doctrine)
- ## Related BIs / Epic (link EP-GROK-001 and specific BI-GROK-00x)
- Note on overlap sweep
- End with the Claude Code generation footer if applicable

Reference the updated AGENTS.md doctrine on worktrees, local-CI sandbox leases, and canonical-runtime evidence where relevant.

Make the description high-signal for reviewers who may not have followed the entire epic.
```

Adapt the specific BI references and evidence for the actual PR.

This should bring more consistency while allowing the richer style seen in recent high-quality PRs.

---

**Status for Grok Epic**: Continue implementation in the worktree. PR when the full set of changes (or a coherent slice) is complete and green per the above process. Evidence (full local-merge-ci gate) collected at PR time as previously agreed.
