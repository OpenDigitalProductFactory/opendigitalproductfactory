# Branch & worktree runbook

**Status:** procedure reference. The *rules* live in [`AGENTS.md`](../../AGENTS.md) §4 and stay always-on; this file holds the how-to, the recovery steps, and the reasoning behind them. Relocated from §4 by BI-0020D511 Phase 1 — no rule was dropped, only its procedure moved. If you are looking for what you are *required* to do, read §4; if you are looking for *how*, you are in the right place.

## Merge readiness

Verify mechanically. Run `pnpm pr:health [<n>]` before claiming a PR is green or mergeable — do **not** eyeball a subset of checks.

The checker asserts every check is *terminal and passing* (no `pending`, and **not** just an assumed "required 4" — `Module Size Guard` / `CodeQL` / `UX-Fit Gate` block too), `mergeable != CONFLICTING`, and **zero unresolved review threads**. That last one matters because `gh pr checks` does not surface review threads at all, and a single bot comment blocks merge — conversation resolution is a required condition. `gh pr merge --admin` does not bypass required checks or conversation resolution.

Full reference: [`docs/testing/pr-health.md`](../testing/pr-health.md).

## Merge mechanics

`gh pr merge <n> --squash --auto`. `main` enforces a merge queue (the `main-merge-queue` ruleset) that brings the PR up to date and squash-merges once required checks pass. Consequences worth knowing:

- Do not hand-merge.
- Do not pass `--delete-branch` — the queue rejects it.
- A branch already in the queue cannot be force-pushed.

## Private/public change segregation is content-based

Any measure of an install's private delta over the community — the `/ops/self-upgrade` "Changes kept on your system" ledger, or any future variant — is computed from a three-dot **tree diff** `<remote>/<branch>...<installBranch>`: the content the install added since the merge-base. Never a commit-range (`A..B`), never `git cherry` / `--cherry-pick`.

The reason is the squash-merge above. Every merged PR gets a fresh SHA on `main` while the install branch keeps the original unsquashed commits, so a commit- or patch-range counts already-public work as private. Measured once at **4,707** commits, ~2,300 of them carrying public `(#NNNN)` PR numbers, while the honest content diff was **0 files**. Content is the only squash-proof signal.

Reference: [`apps/web/lib/self-upgrade/local-changes-ledger.ts`](../../apps/web/lib/self-upgrade/local-changes-ledger.ts) (BI-75C4A412).

## Creating a worktree

```
git worktree add D:/DPF-worktrees/<topic> -b <prefix>/<topic>     # Windows
git worktree add ~/dpf-worktrees/<topic>  -b <prefix>/<topic>     # macOS / Linux
```

⟦runtime: install-local paths — the `D:/` form is the Windows install shape⟧ The dedicated sibling base is canonical for **all three** host CLI surfaces (Claude Code, Codex, Grok) per the 2026-06-05 unified-delivery-surfaces decision #1 — not Claude Code's default `.claude/worktrees/<random>` nesting, and not the older `D:/DPF-<topic>` alongside-the-clone form.

Never share a working tree across sessions: it causes index/HEAD collisions and cross-thread file sweeps.

## Seeding a new worktree

`.mcp.json` and `.vscode/mcp.json` are gitignored — they carry your local `dpfmcp_...` bearer token — so `git worktree add` does not carry them across.

From inside the new worktree, run `scripts/dpf-bootstrap-agent-toolchain.ps1` (Windows) or `bash scripts/dpf-bootstrap-agent-toolchain.sh` (macOS / Linux). It copies MCP config from the root clone, converges Claude Code + Codex CLI plugin state, seeds kernel-tier memory, runs read-only MCP + smoke probes, and prints a single six-state readiness banner. Re-running on a converged worktree is a no-op.

The legacy `scripts/seed-worktree-mcp.{ps1,sh}` and `scripts/ensure-dpf-skill-pack.{ps1,sh}` scripts now shim into the new bootstrap; both names continue to work for one release cycle. ⟦runtime: expiry UNANCHORED — names no release or date, so it cannot expire on its own; anchor it or drop the legacy names⟧

Restart Claude Code in the worktree afterwards so `/mcp` picks up the `dpf` connector. See [`docs/operations/install.md`](../operations/install.md) for the readiness states and what each one means.

## Verification readiness classification

The MCP seed scripts write `.dpf-worktree-readiness.json` with `compile-ready` or `source-only`.

- `compile-ready` — a package manager and dependencies are present, so cheap source-local gates can run.
- `source-only` — Git/MCP/Compose isolation exists, but local compile/test gates are unproven. **Do not claim them as passed.** Use canonical runtime or the shared local-CI convergence sandbox for verification evidence.

The managed probe executes the repository's exact `packageManager` pin even
when an agent host supplies a newer pnpm. It also runs `pnpm ignored-builds`;
any unclassified install script keeps the tree `source-only` and emits a stable
`dependencyPolicyReviewKey` keyed by base SHA, package/version, and reason. Use
that key as the backlog intake origin so the canonical ingester increments one
occurrence instead of filing one review per worktree.

## Compose project isolation

`docker-compose.yml` defaults to the root project `dpf`; linked worktrees must override it with an ignored `.env` value such as `COMPOSE_PROJECT_NAME=dpf-<topic>`. The worktree MCP seed scripts write this automatically.

Do not run `docker compose up`, `docker compose down`, or profile/harness Compose commands from a worktree until that worktree has a unique project name. CI and integration harnesses must use `node scripts/dpf-compose.mjs` with a unique `COMPOSE_PROJECT_NAME`. A `down --volumes` against the root `dpf` project requires an intentional recovery/reinstall context and `DPF_ALLOW_DESTRUCTIVE_COMPOSE=1`.

## Freshness — a stale worktree base is a landmine

`main` moves fast. A topic worktree created days ago and never refreshed sits on an old base. That base carries files that have since moved on `main` (a since-migrated baseline, for example), which surface as modify/delete conflicts only at PR time — and it makes the checkout's `merge-base` with `origin/main` disappear on a shallow clone.

Before serious implementation: `git fetch origin main`, confirm your base is current, rebase if not. The `SessionStart` `worktree-freshness` hook (`scripts/hooks/worktree-freshness.{sh,ps1}`) prints a warning automatically when it detects a stale base; silence with `DPF_SKIP_WORKTREE_FRESHNESS=1`.

The durable fix is to create worktrees from a freshly-fetched `origin/main` in the first place.

## Root-clone freshness — the shared root must stay on current `main`

This is a *different* concern from worktree-base freshness above: peer worktrees junction `@dpf/*` workspace packages into the **shared root clone**'s source tree, so if the root clone's own checkout falls behind `origin/main`, `pregate-preflight` aborts with *"Stale root clone detected (BI-A900EA3F)"* for **every** worktree until the root is fast-forwarded — even worktrees whose own branch is perfectly current.

The `SessionStart` `root-clone-freshness` hook (`packages/dpf-skill-pack/hooks/root-clone-freshness.mjs`) fast-forwards the root clone to `origin/main` automatically at session start — **fast-forward only**, and only when the root is on `main` and clean. It **refuses** (and prints an advisory) when the root is off-main, detached, or dirty, because those states mean work is stranded there and a forced move would corrupt it. Run it by hand any time with `node scripts/root-clone-refresh.mjs [--json]`; silence the hook with `DPF_SKIP_ROOT_CLONE_REFRESH=1`. This runs the same safe `git merge --ff-only origin/main` that the stale-root-clone detector already recommends, so it never conflicts with the root-clone delete/mutation guard.

## Reaping safety — a live session's worktree is never reaped

The worktree janitor (`scripts/worktree-janitor.mjs`, fleet backstop; and the SessionEnd reaper) removes merged+clean worktrees. Two safety rails keep it from removing a worktree out from under work:

The SessionEnd reaper (`scripts/hooks/session-reaper.sh`) also terminates the ending session's own node sidecars and releases the leases that session owns. It is scoped on purpose: a process counts as the session's only when its command line names the session's worktree *outside* `node_modules` (shared binaries prove nothing about ownership) and names no other worktree; and a lease is released only when its `ownerSessionId` is the ending session. A session started in the root clone therefore never reaps a sibling worktree's local-CI gate run, which is how three gate runs died by SIGTERM on 2026-09-06 (BI-B0122A22).

- **Live-session gate.** A session writes a gitignored `.dpf-session-heartbeat.json` marker into its worktree, refreshed every turn by the `worktree-session-heartbeat` hook (SessionStart/Stop) and removed on SessionEnd. The janitor treats a fresh marker (TTL default 60 min, `DPF_WORKTREE_SESSION_HEARTBEAT_TTL_MIN`) as `KEEP`, **outranking** Tier-A eligibility — because a live session's tree first becomes Tier-A the moment its own PR merges, which is exactly when it must not be reaped.
- **Abandoned-merge quarantine.** A worktree with `MERGE_HEAD` present and **no** live session is classified `FLAG_ABANDONED_MERGE`: surfaced in the janitor summary and never auto-reaped, since an interrupted merge can hide un-reconciled work. A *live* session's in-progress merge is kept, not flagged.

## Rebasing on a shallow clone — never a bare `git rebase origin/main`

⟦runtime: precondition — shallow checkouts only; on a full clone the phantom replay does not occur⟧

This checkout is shallow (`git rev-parse --is-shallow-repository` → `true`), so a stale branch has no visible merge-base with `origin/main`. A bare `git rebase origin/main` then tries to replay *thousands* of phantom commits, starting from the repo's Initial commit, and unwinds your working tree.

- If a rebase ever balloons far past your own commit count, **`git rebase --abort` immediately**. Your committed and pushed commits are safe.
- Replay only your own commits: `git rebase --onto origin/main <the-commit-you-branched-from>`.
- Trust `gh pr view <n> --json files,additions,deletions` for true PR scope over a local `git diff HEAD origin/main`, which compares unrelated shallow trees.

## Housekeeping

If `SessionStart` prints `DPF HOUSEKEEPING DUE`, run it. The `janitor-throttle` hook (`scripts/hooks/janitor-throttle.{sh,ps1}`) fires at most once per 24h across all worktrees. Comply; don't skip silently. Details are in the hook's own header comment.
