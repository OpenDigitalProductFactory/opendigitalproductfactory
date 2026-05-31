---
title: Worktree is source-control isolation, not runtime isolation
slug: worktree-is-source-control-not-runtime
pageKind: principle
status: published
abstract: Thread worktrees give source-control isolation — branch, index, untracked-file space. They are NOT a second DPF runtime. For runtime-bound verification, run against the canonical install (or a governed shared nonprod environment), not a hand-built worktree harness. Harness friction inside a worktree is not a product defect.
principleTier: commandment
principleDirection: Implement and commit from the thread worktree; perform runtime-bound functional validation against the canonical local install or a governed shared nonprod environment; never absorb "make the worktree runnable" into an incidental feature/fix thread.
principleDimensionVector: {"evidence_density": 0.9, "governance_compliance": 0.7, "long_term_maintainability": 0.6, "speed_to_value": 0.5}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
  - ring-4-sandbox-prod
principleConsumerArchetype: route-domain-specific
principleConsumerContexts:
  - engineering-flow
  - build-studio
---

## Rule

Thread worktrees provide **source-control isolation, not runtime isolation**. When a change touches runtime-bound platform behavior, agents should implement and commit from the thread worktree but perform functional validation against the canonical local install / runtime, unless the task explicitly requires a disposable runtime clone. Do not spend time making a thread worktree into a full DPF runtime unless that is the object of the task.

## Why

A worktree's job is to keep one thread's commits off another thread's HEAD. That is a complete, useful job. It is **not** the same job as standing up a second runnable copy of the platform: workspace package links, generated clients (Prisma), bundler workspace-root constraints (Next/Turbopack), pnpm/corepack on PATH, and Docker stack composition all resolve against the install the worktree was linked from, not against the worktree itself. Treating the worktree as a runtime means re-creating those concerns from scratch every time a thread starts — work the canonical install already did.

The failure mode observed in PR #1398 was the foreseeable result of skipping this distinction: a thread spent its budget installing pnpm/corepack on the worktree PATH, copying generated Prisma client into the worktree, symlinking node_modules across workspaces, and chasing Next/Turbopack symlink-outside-workspace rejections — all to satisfy a `next build` that ran cleanly on the canonical install. None of those symptoms were product defects; all were harness artifacts of trying to run the platform out of a linked worktree.

## The 6-step validation model

1. **Isolated worktree/branch for code changes.** Source-control isolation is the worktree's job — do it there.
2. **Run cheap/source-local checks in the worktree** when available — targeted unit tests, TypeScript checks, lint.
3. **For platform-bound behavior, verify against the root/live install** or the governed shared nonprod environment, not against a worktree-local harness.
4. **If a build gate can't run in the worktree because of runtime harness issues, classify it as a harness limitation, NOT a product failure.** This is the diagnostic discipline; see also [`structural-verification-is-not-functional`](structural-verification-is-not-functional.md).
5. **Capture exact canonical-runtime verification evidence in the PR** — command, output, URL, MCP evidence record, or CI job link. A worktree-only "green" for a runtime-bound gate is a source-control checkpoint, not execution evidence. See [`never-fabricate`](never-fabricate.md).
6. **Reserve "make worktree runnable" work for a dedicated platform-process backlog item**, not incidental feature/fix threads.

## How To Apply

- Edit, commit, and push from the worktree. That is the worktree's purpose.
- Run typecheck and targeted unit tests in the worktree when the workspace shape allows.
- Run `next build`, UX verification, MCP-touching suites, and migration-apply checks against the canonical local install (root clone Docker stack at the install's `AUTH_URL` / `APP_URL`) or a leased shared nonprod environment (`dpf-use-shared-nonprod-environment`).
- If a runtime-bound check fails *only* in the worktree, treat it as a harness finding: reproduce on the canonical install before naming any product cause; file a platform-process BI for the worktree gap; do NOT block the PR on the harness artifact.
- Record evidence in the PR from the substrate that produced it. Name the substrate (root install / shared nonprod lease id / CI job URL).

## Known harness-artifact taxonomy (not product defects)

- `pnpm: command not found` / corepack missing on the worktree PATH
- Workspace package resolution pointing outside the worktree root
- Prisma client absent because `prisma generate` only ran in the root clone
- Next/Turbopack refusing a `node_modules` symlink that escapes the workspace
- Docker/Compose collisions when `COMPOSE_PROJECT_NAME` isn't isolated

## Decision Dimensions

- **Substrate of evidence** — canonical install / shared nonprod / CI run vs. worktree-local harness.
- **Harness vs. product** — does the symptom reproduce on the canonical install, or only in the worktree?
- **Scope discipline** — is "make the worktree runnable" the object of this BI, or am I absorbing it into an unrelated thread?

## Related

- [`worktree-per-session`](worktree-per-session.md) — source-control isolation half of the doctrine.
- [`keep-root-clone-as-merge-worktree`](keep-root-clone-as-merge-worktree.md) — root clone is also the runtime-verification substrate.
- [`build-gate-mandatory`](build-gate-mandatory.md) — where each gate runs.
- [`structural-verification-is-not-functional`](structural-verification-is-not-functional.md) — verify on the install posture an operator gets.
- [`never-fabricate`](never-fabricate.md) — name the substrate the evidence came from.
- [AGENTS.md §5](../../../../AGENTS.md) — operational summary.
- [Tiered dev-loop spec §2.1](../../../superpowers/specs/2026-05-31-tiered-dev-loop-isolation-design.md) — design context.

## Origin

Founder rule, 2026-05-31, from PR #1398 retrospective.
