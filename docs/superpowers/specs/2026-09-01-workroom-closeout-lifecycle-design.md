# Workroom Closeout Lifecycle — Delivered vs. Abandoned, with a Resume Grace

**Status:** design · **Date:** 2026-09-01 · **Epic:** EP-WORKROOM-CLOSEOUT
**Backlog:** BI-9FF39058, BI-33E1E5D7, BI-154689E7, BI-75565393, BI-946E5359

## Problem

A Workroom accumulates four loose ends over its life: the **room** row (status), the
agent **thread**, the local git **worktree**, and the remote **branch**. When work
finishes — or a session dies — these are closed out inconsistently:

1. **Delivered work is mislabelled abandoned.** The WS9 reaper (`work-capsule-reaper.ts`)
   transitions every reapable room to `abandoned`. A room whose branch actually
   **merged** is delivered, not abandoned — archiving it as "abandoned" corrupts the
   backlog signal and the operator's read of what happened.
2. **A token-limited session is reaped as dead.** A lease-backed external session
   (Claude / Codex / Grok CLI) auto-renews its lease on every write; when the client
   runs out of tokens the lease simply lapses. The session is **paused**, not dead —
   it resumes and renews when the usage window resets. Reaping it (or letting another
   agent claim-steal its room) destroys in-flight work.
3. **The remote branch is a silent loser.** Deleting an **unmerged** branch loses
   commits that live nowhere else; but merged-slip branches linger as orphans.

This must work **regardless of client** (server/host machinery, not client cleanup
logic), and **without any external LLM** — the delivered/abandoned/paused decision is
**procedural**, computed from local git and lease state.

## Decision

Closeout is governed by a single **disposition** derived from signals that only move
with real work, and actuated by the loose end's own safe owner — coordinated by a
**shared, procedural merged-signal**, never by an LLM.

### The disposition (pure core — `liveness.ts`)

`classifyWorkCapsuleLiveness` gains two states and a `disposition`:

| Liveness | Meaning | isLive | isReapable | disposition |
|---|---|---|---|---|
| `delivered` | branch head reachable from trunk (merged) | false | **true** | `delivered` |
| `paused` | lease lapsed **within** the resume grace | **true** | false | — |
| `lease-expired` | lease lapsed **past** the grace | false | true | `abandoned` |
| `build-terminal` / `idle-stale` | dead by build/idle signal | false | true | `abandoned` |
| `live` / `durable-wait` / `no-signal` | active or benefit-of-the-doubt | true | false | — |

Precedence: terminal status → **delivered** → open PR → durable-wait → build-terminal →
lease (expired-within-grace ⇒ `paused`, expired-past-grace ⇒ `lease-expired`, valid ⇒
`live`) → null-lease signals → no-signal. **Delivered wins over lease state**: merged
work is done whether or not the session could resume.

The resume grace (`WORK_CAPSULE_PAUSE_GRACE_MS`, default **24h**) is injectable so the
policy is testable and tunable. It is deliberately conservative — the cost of gracing a
truly-dead room for a day (it lingers one extra reaper tick) is far below the cost of
reaping a session that was about to resume.

### The DELIVERED signal is procedural and local (BI-9FF39058)

`deliveredSignal.merged` is computed by the **caller**, never inside the pure classifier,
from **local git reachability**:

```
git merge-base --is-ancestor <headSha> origin/main   # exit 0 ⇒ merged
```

`git-scanner.ts` exposes `isReachableFromTrunk(repoRoot, headSha)` → `true` (merged) /
`false` (definitively unmerged) / `null` (indeterminate — sha not fetched, no repo, git
absent). No GitHub PR API. No LLM. It answers when the network and every external
provider are down. It reads git **objects only** — never a worktree — so it is
junction-safe. `trunkRefExists()` lets a caller skip the whole batch on a repo-less
runtime, where every signal is left `null` and the lease/grace path governs.

This is the **same** reachability test the host-side `worktree-janitor.mjs` already uses
(`isMerged` → `merge-base --is-ancestor`). Two runtimes (portal TypeScript, host script)
deliberately carry the same one-line algorithm; there is no LLM and no second source of
truth for *what merged means*.

### Coordinated closeout by shared signal (BI-154689E7, BI-75565393)

The four loose ends are closed by their **safe owners**, coordinated by the shared
disposition — not by one call that reaches across every subsystem (that call would have
to touch the filesystem and the remote, breaking junction-safety and the no-automated-
outward-action rule):

| Loose end | Owner | Behaviour |
|---|---|---|
| **Room** status | `work-capsule-reaper.ts` (this change) | `delivered` → **archived**; dead → **abandoned**; `paused` → untouched. |
| **Worktree** | `worktree-janitor.mjs` (existing) | Tier A (merged + clean + no open PR/lease/live-session/pin) → removed via junction-safe helper. Tier B (unmerged/dirty/live) → **observe only**. |
| **Branch** | `worktree-janitor.mjs` (existing) | Merged branch → `branch -D` **after** its worktree is removed (Tier A). **Unmerged branch is never auto-deleted** — its commits live only there. |
| **Thread** | terminal room status | The reaper acts precisely when the session is delivered or dead; a dead session's thread is already terminal. |

The room reaper archives via the **plain** status path (`archived` is a terminal status
that does **not** route through the governed-completion gate — only `complete` does). This
is deliberate: closeout is **disposal**, not a governed `done`, and must never deadlock on
a review receipt the direct-merge external work could never accrue.

**Room-side protection mirrors the worktree side.** Because `paused` is `isLive`, the
backlog claim-ownership path (`backlog-workroom-ownership.ts`) already treats a paused
room as owned — so another agent cannot claim-steal a token-limited session's room inside
the grace, exactly as the janitor's `hasLiveSession` / `hasActiveLease` facts keep its
worktree in Tier B.

### The sweep (BI-946E5359)

The one-time closeout of the current delivered-but-stranded backlog **is** the scheduled
reaper running the new logic — no separate code path. It is env-gated
(`DPF_WORKCAPSULE_REAPER_ENABLED=1` to observe, `…_AUTO_REAP=1` to actuate), so the
operator runs the sweep by enabling actuation and reviewing the dry-run candidate set
first. Delivered rooms archive; genuinely-dead rooms abandon; paused rooms are left.

## Degradation & safety

- **Repo-less runtime.** If the reaper runs where `origin/main` is not fetched (a portal
  image without the checkout), `trunkRefExists` is false, delivered-detection is skipped,
  and every room falls to the lease/grace path. A merged room past the grace would then be
  **abandoned** rather than **archived** — a terminal, reversible closeout that loses **no
  work** (the reaper never deletes branches or worktrees). To get delivered-detection, run
  the reaper with `DPF_REPO_ROOT` pointing at a checkout with a fetched trunk.
- **No automated outward action.** The reaper writes DB rows only. It never pushes a
  remote branch delete. Merged remote branches are cleaned by GitHub's delete-on-merge;
  unmerged remote orphans are surfaced for operator review, never auto-deleted.
- **Dry-run default.** `reapStaleWorkCapsules` writes nothing unless `dryRun:false`.
- **Reversible.** `abandoned` is undone by re-promoting the backlog item / re-adopting the
  branch; `archived` is a disposal record, and the merged work is on the trunk.

## Research & Benchmarking

- **GitHub `delete_branch_on_merge`** (industry default): auto-deletes a branch *on merge*.
  DPF adopts it for the merged-remote case and adds the missing pieces it does **not**
  cover — the room row, the local worktree, and merged-**slip** branches (merged outside
  the standard flow). We reject relying on the PR API for the *delivered* decision:
  reachability from the local trunk is faster, works offline, and is the same fact the
  merge itself asserts.
- **`git worktree prune`** removes worktree *administrative* entries for deleted
  directories; it does not decide *whether* a branch's work has landed or whether a session
  is alive. The janitor's tiered classifier (merged + clean + no live session/lease) is the
  policy layer prune lacks. DPF keeps `prune`-equivalent removal behind the junction-safe
  helper and adds the liveness/merged policy on top.
- **Kubernetes TTL-after-finished / reaper controllers** (background GC of finished work):
  the canonical pattern is *classify liveness from real signals, act only on terminal
  state, default to observe*. DPF mirrors it (dry-run default, env-gated actuation) and
  adds the domain nuance those controllers lack: a **paused** state distinct from
  **finished**, because a token-limited agent session resumes — a Job pod does not.

## Alternatives rejected

- **LLM-judged delivered/abandoned.** Rejected: must work with external LLMs unavailable;
  a merge is a deterministic git fact, not a judgment call.
- **GitHub PR API for delivered.** Rejected: network- and provider-dependent; local
  reachability is the ground truth and is offline-capable.
- **One monolithic closeout call** that archives the room, `rm`s the worktree, and deletes
  the branch together. Rejected: it would make the DB reaper touch the filesystem
  (breaking junction-safety) and the remote (an automated outward action). The safe design
  is one shared *signal* with per-owner actuation.
- **No grace (reap on lease expiry).** Rejected: it reaps token-paused sessions and lets
  their rooms be claim-stolen — the exact failure this epic exists to fix.

## Test coverage

`liveness.test.ts`, `work-capsule-reaper.test.ts`, `work-capsule-presenter.test.ts`,
`liveness-inventory.test.ts`, `backlog-workroom-ownership.test.ts`,
`work-capsule-store.test.ts`, `git-scanner.test.ts` — delivered overrides lease; paused
within grace is live + not reapable + not claim-stealable; expired-past-grace abandons;
disposition tagging; the reaper archives delivered and abandons dead; procedural
reachability decisions + repo-less short-circuit + indeterminate-null.
