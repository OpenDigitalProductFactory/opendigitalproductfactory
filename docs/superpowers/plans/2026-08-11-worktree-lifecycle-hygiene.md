# Worktree lifecycle hygiene — liveness-before-reap, root-clone freshness, abandoned-merge quarantine

**Date:** 2026-08-11
**Epic:** EP-PROCESS-SPINE
**Status:** implemented (this PR)
**Surface:** host worktree governance (scripts + dpf-skill-pack hooks)

> **Backlog note.** This work was surfaced during a stuck-PR sweep, not from a
> pre-filed BI. The DPF MCP connector was not reachable from the authoring session
> (source-only worktree, no portal/DB view), so the live `BacklogItem` could not be
> filed from here. **Action for an MCP-connected operator/Build Studio:** file a BI
> under EP-PROCESS-SPINE — *"Worktree janitor liveness gate + root-clone auto-ff +
> abandoned-merge quarantine"* — and back-link this plan. This file deliberately
> carries **no** `**Backlog item:**` line so it is not mistaken for coverage
> evidence that does not yet exist.

## Problem

Two worktree-lifecycle failures observed during the sweep:

1. **A janitor reaped an active session's worktree mid-session.** A worktree had
   its `.git` linkage removed and was marked `prunable` while a session was still
   working in it. Git then silently fell through to the shared **root clone**
   (`D:/DPF`), so a subsequent `git checkout -B …` mutated the root clone's checked-
   out branch instead of the worktree — the documented "deleted-worktree → root-
   clone" trap, and a near-miss root-clone corruption.

2. **The root clone was left 18 commits behind `origin/main`.** Because peer
   worktrees junction `@dpf/*` workspace packages into the root tree, a stale root
   makes `pregate-preflight` abort with *"Stale root clone detected (BI-A900EA3F)"*
   for **every** worktree until someone fast-forwards the root.

## Design grounding

- **Source of truth:** the `worktree-selection-and-reaping` kernel principle and
  the multi-client governance-parity spec
  (`docs/superpowers/specs/2026-07-26-multi-client-governance-parity-design.md` §D4).
  The principle *already* names a worktree's lifecycle as `active` (**"claimed
  capsule, live heartbeat"**) / `idle` (**"no heartbeat past threshold"**) / `done`.
  This work makes that heartbeat real and feeds it to the reaper — extending the
  existing lifecycle, not inventing a new one.
- **Existing substrate reused:** `scripts/lib/worktree-janitor-core.mjs` (the pure
  reaping classifier), `scripts/worktree-janitor.mjs` (the fleet backstop CLI),
  `scripts/lib/stale-root-clone.mjs` (BI-A900EA3F **detector** — this plan adds the
  **remedy**), `scripts/lib/junction-safe-worktree-remove.mjs`, and the session-
  lifecycle hook plane in `packages/dpf-skill-pack/hooks/`.
- **Why files, not DB/MCP, for liveness:** the fleet janitor is a host Node script
  that may have no portal/DB view, and every CLI surface (Claude/Codex/Grok) shares
  the same host filesystem. A gitignored marker is the liveness signal all of them
  can read without coordination.

### Research & benchmarking

Git itself has no "is a session using this worktree" signal — `git worktree prune`
keys only on whether the working directory / `.git` file still exists, which is
exactly what made the incident silent. Common practice (tmux/VS Code liveness, PID
files, lockfiles) uses a refreshed heartbeat file with a TTL; DPF's own edge-node
service and the WorkCapsule lease already follow the "renew-on-activity, expire ==
dead" pattern. We adopt the same shape (marker refreshed every turn, TTL window)
rather than OS-specific open-handle probing, which is brittle on Windows.

## Fixes

### 1. Liveness gate — never reap an in-use worktree (safety)

- New `scripts/lib/worktree-session-heartbeat.mjs`: a live session writes a
  gitignored `.dpf-session-heartbeat.json` marker (refreshed every turn), read as a
  TTL-bounded liveness signal (default 60 min; `DPF_WORKTREE_SESSION_HEARTBEAT_TTL_MIN`).
- New hook `packages/dpf-skill-pack/hooks/worktree-session-heartbeat.mjs`, wired on
  **SessionStart + Stop** (write/refresh) and **SessionEnd** (remove). It is
  non-destructive by construction (only ever writes/deletes one marker), which is
  why it is safe on the per-turn `Stop` event — unlike the destructive reaper, which
  stays confined to SessionEnd (BI-E5D810B8).
- `classifyWorktree` gains a `hasLiveSession` fact that returns `KEEP` **above** the
  merged/Tier-A check — because a live session's tree first becomes Tier-A eligible
  the moment its own PR merges, which is exactly when it must **not** be reaped. The
  fleet janitor (`worktree-janitor.mjs`) reads the heartbeat per worktree.
- The marker is gitignored so it never dirties the tree (which would both muddy the
  janitor's `dirty` signal and block a worktree's own SessionEnd reap).

### 2. Root-clone freshness — keep the root fast-forwarded to origin/main

- New `scripts/lib/root-clone-refresh.mjs` + CLI `scripts/root-clone-refresh.mjs`:
  **fast-forward only**, and only when the root is on `main` and clean. It **refuses**
  (loudly, never forcing) when the root is off-main, detached, or dirty — those are
  the "root stranded on a feature branch / mid-edit" states a forced move would
  corrupt (the exact states `root-clone-guard.mjs` blocks for the agent).
- New SessionStart hook `packages/dpf-skill-pack/hooks/root-clone-freshness.mjs`
  runs the safe `git merge --ff-only origin/main` directly (not via the Bash tool),
  which is precisely the remedy the stale-root-clone detector already prints — so it
  complements `root-clone-guard.mjs` rather than fighting it. A SessionStart hook is
  the robust cross-surface plane; a portal cron can go dark or not see host worktrees.

### 3. Abandoned-merge quarantine — flag, don't silently leave

- `classifyWorktree` gains a `midMerge` fact (`MERGE_HEAD` present). A mid-merge with
  **no live session** is an abandoned merge; it is classified `FLAG_ABANDONED_MERGE`
  — surfaced in the janitor summary and **never** reap-eligible (an interrupted merge
  can hide un-reconciled work). A *live* session's in-progress merge is `KEEP` (the
  liveness gate wins), so only genuinely abandoned merges are flagged.

## Verification

`node --test` (source-only, no workspace install needed):
`worktree-janitor-core`, `worktree-session-heartbeat` (lib + hook, incl. a real
linked-worktree write/remove integration case), `root-clone-refresh` (lib), and
`root-clone-freshness` (hook). New tests are registered in
`scripts/lib/ci-policy-guards.mjs` (the hand-enumerated inventory) so CI runs them.
`worktree-janitor-core.test.mjs` was promoted from the deliberate-exclusion allowlist
into the inventory since its new liveness/abandoned-merge assertions must run.

## Rollout / safety

All new behavior fails open. The heartbeat and root-freshness hooks have skip envs
(`DPF_SKIP_WORKTREE_SESSION_HEARTBEAT=1`, `DPF_SKIP_ROOT_CLONE_REFRESH=1`). No change
to the reaper's default posture: it is still dry-run/observe unless
`DPF_WORKTREE_JANITOR_AUTO_REAP=1`; this plan only makes auto-reap *safer* by adding
the liveness gate and the abandoned-merge quarantine on top of it.
