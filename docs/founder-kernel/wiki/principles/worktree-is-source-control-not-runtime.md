---
title: Worktree is source-control isolation, not runtime isolation
slug: worktree-is-source-control-not-runtime
pageKind: principle
status: published
abstract: Thread worktrees give source-control isolation — branch, index, untracked-file space. They are NOT a second DPF runtime. For runtime-bound verification, run against the canonical install (or a governed shared nonprod environment), not a hand-built worktree harness. Harness friction inside a worktree is not a product defect.
principleTier: commandment
principleDirection: Implement and commit from the thread worktree; perform runtime-bound functional validation against the canonical local install or the shared local-CI convergence sandbox via lease; do NOT stand up a runnable runtime per worktree — the model does not scale past tens of concurrent worktrees, let alone the thousands DPF expects.
principleDimensionVector: {"evidence_density": 0.9, "governance_compliance": 0.7, "long_term_maintainability": 0.6, "speed_to_value": 0.5}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
  - ring-4-sandbox-prod
principleConsumerArchetype: universal
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
6. **Pre-PR runtime verification routes through the shared local-CI convergence sandbox** — one runtime (or a small lease-managed pool) that every worktree leases sequentially via `claim_nonprod_environment_lease(environmentKey="local-integration-ci")`. The sandbox pulls the worktree's branch, runs canonical gates + UX verification, records evidence on the lease, releases back to a clean state. Worktrees never become standalone runtimes — at 1,000+ concurrent worktrees (DPF's expected steady state) per-worktree runnable harnesses are not tenable on storage, RAM, CPU, or port assignment. The sandbox is where converge + de-conflict + verify happens before the PR ships.

## How To Apply

- Edit, commit, and push from the worktree. That is the worktree's purpose.
- Run typecheck and targeted unit tests in the worktree when the workspace shape allows.
- Run `next build`, UX verification, MCP-touching suites, and migration-apply checks against the canonical local install (root clone Docker stack at the install's `AUTH_URL` / `APP_URL`) or a leased shared nonprod environment (`dpf-use-shared-nonprod-environment`).
- If a runtime-bound check fails *only* in the worktree, treat it as a harness finding: reproduce on the canonical install before naming any product cause; file a platform-process BI for the worktree gap; do NOT block the PR on the harness artifact.
- Record evidence in the PR from the substrate that produced it. Name the substrate (root install / shared nonprod lease id / CI job URL).

## The shared convergence sandbox (and why it's not per-worktree)

DPF's expected steady state is **1,000+ concurrent worktrees**, growing to 10,000+. At that scale, per-worktree runnable runtimes are structurally untenable:

- **Disk**: 1k worktrees × ~100 MB checked-out source ≈ 100 GB of source alone; runnable runtimes add Docker images + DB volumes + node_modules and balloon to terabytes.
- **RAM / CPU**: even a small Postgres + Next runtime per worktree is hundreds of MB resident; concurrent active sets crush the host.
- **Ports**: dynamic-port schemes fight the OS's ephemeral range past low hundreds of stacks.
- **State drift**: per-worktree DBs require per-worktree seed + migration management; the matrix is unmaintainable.

The right architecture (already named in the substrate by `nonprod-environment-lease.environmentKey: "local-integration-ci"` and the running `dpf-dev-*` stack at :5433/:6334/:7475):

**One shared local-CI convergence sandbox runtime** (initially N=1; a small lease-managed pool later if throughput requires). Every worktree leases it sequentially for the runtime-verification slice of its PR:

1. Worktree commits its diff and pushes its branch (origin or local).
2. Worktree calls `claim_nonprod_environment_lease(environmentKey="local-integration-ci", branchName, worktreePath, ports, expiresAt)`.
3. Sandbox checks out the leased branch, runs the canonical gates (`next build`, UX, MCP-touching, migration smoke).
4. Lease records evidence: command, output, screenshot link, MCP record id, lease id.
5. Worktree's PR cites the lease evidence in the Test plan.
6. Lease released; sandbox resets to a known-clean state for the next worktree.

The sandbox is also where **converge + de-conflict** happens — two worktrees touching adjacent files learn whether they collide on the sandbox before either ships, not after both PRs merge to main and break it. The lease workflow is the serialization point.

This deliberately avoids the per-worktree-runnable model. "Make THIS worktree runnable" is wrong scope on every layer except one: the dedicated platform task whose explicit deliverable is hardening the sandbox itself (or, very rarely, a destructive experiment where a disposable runtime IS the deliverable).

## Known harness-artifact taxonomy (not product defects)

- `pnpm: command not found` / corepack missing on the worktree PATH
- Workspace package resolution pointing outside the worktree root
- Prisma client absent because `prisma generate` only ran in the root clone
- Next/Turbopack refusing a `node_modules` symlink that escapes the workspace
- Docker/Compose collisions when `COMPOSE_PROJECT_NAME` isn't isolated

## Decision Dimensions

- **Substrate of evidence** — canonical install / shared nonprod / CI run vs. worktree-local harness.
- **Harness vs. product** — does the symptom reproduce on the canonical install, or only in the worktree?
- **Scope discipline** — is the runtime-verification work routing through the shared convergence sandbox lease (right), or am I attempting to make this specific worktree runnable (wrong at scale)?

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
