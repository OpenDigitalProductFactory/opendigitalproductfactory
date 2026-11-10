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

## Read-only work needs no worktree

Review, diagnosis, research and answering a question about the source change nothing, so they get no working copy. Create the room on the read-only shape (`create_workroom` with `workShape: "source-inquiry@1.0.0"`) and read through `read_source_at_version`, `search_source_at_version`, `list_source_directory` and `read_project_file`, or `git show origin/main:<path>` against the root clone. A `source-inquiry` room cannot reach worktree provisioning: `plan_workroom_worktree`, `claim_workroom_scope` and `adopt_worktree` refuse it with `worktree_provision_not_admitted`, and so does the WorktreeCreate hook while the session holds such a room. When the inquiry turns out to need a change, claim the item with a delivery shape; that claim is the route to a worktree ([design](../superpowers/specs/2026-10-14-worktree-provisioning-under-gpp-design.md), BI-D1FB8C4D).

## Creating a worktree

Create worktrees through the governed path, which admits and binds the Workroom **before** the worktree exists:

```
bash scripts/new-dev-worktree.sh <topic> [<prefix>]          # manual path
```

Claude Code's auto-created worktrees go through the WorktreeCreate hook, which runs the same library (`scripts/lib/worktree-provision.mjs`). Both refuse, and create nothing, when the platform refuses or cannot be reached. Raw `git worktree add` bypasses the admission; a guard for it is BI-25A45D5C.

**Break-glass.** When the platform is down and an operator authorizes recovery (AGENTS.md §1), set `DPF_WORKTREE_BREAK_GLASS="<operator: reason>"` for that one command. The worktree is created unbound with a `dpf-workroom-pending.json` marker in its git dir; bind it with `adopt_worktree` once the platform is back. Break-glass never overrides a refusal: a refusal is an authorization answer, not an outage.

⟦runtime: install-local paths — the `D:/` form is the Windows install shape⟧ The dedicated sibling base (`<root>-worktrees/<topic>`) is canonical for **all three** host CLI surfaces (Claude Code, Codex, Grok) per the 2026-06-05 unified-delivery-surfaces decision #1 — not Claude Code's default `.claude/worktrees/<random>` nesting, and not the older `D:/DPF-<topic>` alongside-the-clone form.

Never share a working tree across sessions: it causes index/HEAD collisions and cross-thread file sweeps.

## Seeding a new worktree

Claude Code's `dpf` connector is the `dpf-platform` plugin, so every worktree has it without a per-worktree file; no project `.mcp.json` is copied (a second `dpf` entry would load beside the plugin's, BI-5201141C). `.vscode/mcp.json` is gitignored local connection configuration, so `git worktree add` does not carry it across.

From inside the new worktree, run `scripts/dpf-bootstrap-agent-toolchain.ps1` (Windows) or `bash scripts/dpf-bootstrap-agent-toolchain.sh` (macOS / Linux). It copies `.vscode/mcp.json` from the root clone when present, converges Claude Code + Codex CLI plugin state, seeds kernel-tier memory, runs read-only MCP + smoke probes, and prints a readiness banner; the readiness record lands in `~/.dpf/agent-toolchain-state.json`, never in `install-state.json`, so running it while a self-upgrade is draining is safe (BI-95DF1BFC). Re-running on a converged worktree is a no-op. Supported interactive connections default to OAuth, including Codex on HTTP loopback. An explicit process `DPF_MCP_URL` wins; otherwise setup uses the saved https user preference, then an HTTPS `PUBLIC_URL`. With none selected, the skill-pack updater's canonical `https://localhost/api/mcp/v1` applies (BI-772023BC). Only https endpoints persist for future sessions; Codex and Grok keep any loopback-http choice in their own configs (BI-8FD7C0C9). When the Grok command is installed, the same bootstrap creates one client_credentials client for the installing operator and refreshes `~/.grok/dpf-mcp-token` before it expires. Grok reads that file; no token is pasted, and revoking the client in Admin stops later refreshes. Setup never mints a PAT because OAuth authorization is pending; the banner distinguishes written configuration from a verified connection. For explicit legacy credentials and client compatibility requirements, follow the [MCP authorization runbook](mcp-tool-authorization-runbook.md).

The legacy `scripts/seed-worktree-mcp.{ps1,sh}` and `scripts/ensure-dpf-skill-pack.{ps1,sh}` scripts now shim into the new bootstrap; both names continue to work for one release cycle. ⟦runtime: expiry UNANCHORED — names no release or date, so it cannot expire on its own; anchor it or drop the legacy names⟧

Restart Claude Code in the worktree afterwards so `/mcp` picks up the `dpf` connector. See [`docs/operations/install.md`](../operations/install.md) for the readiness states and what each one means.

## Routine client permissions

Bootstrap also converges routine Codex, Claude and Grok permissions for the
explicitly named source worktree through the signed updater's shared
`--permissions-only` writer. Use that worktree as the client's actual workspace;
the installed runtime remains an MCP administration context. Existing restrictive
profiles, deny/ask rules and managed requirements keep their authority. A saved
configuration does not widen an already-running managed chat.

Routine independent review reuses the DEV task's existing scope, budget, grants
and consent. No new approval is needed solely for a delivery phase. Source tests,
protected publication and actual authority refusals still apply. See
[routine development client permissions](../operations/install.md#routine-development-client-permissions)
for backups, native diagnostics, parser compatibility and effective-session proof.

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

A successful managed install can retain qualified dependency evidence in this
worktree's Git metadata when pnpm omits its build record after a no-op install.
Ordinary probes still check current artifacts, dependency resolution, workspace
links, staleness and unclassified scripts. Changed install inputs or metadata,
failed installs and missing or invalid evidence prevent reuse. This evidence is
not a build/test result and grants no build-script permission.
Each probe rediscovers workspace manifests, so editing, adding or removing a
package invalidates prior evidence. Custom hooks, patches and unsupported
workspace formats keep the normal managed-install path.

## Compose project isolation

`docker-compose.yml` defaults to the root project `dpf`; linked worktrees must override it with an ignored `.env` value such as `COMPOSE_PROJECT_NAME=dpf-<topic>`. The worktree MCP seed scripts write this automatically.

Do not run `docker compose up`, `docker compose down`, or profile/harness Compose commands from a worktree until that worktree has a unique project name. CI and integration harnesses must use `node scripts/dpf-compose.mjs` with a unique `COMPOSE_PROJECT_NAME`. A `down --volumes` against the root `dpf` project requires an intentional recovery/reinstall context and `DPF_ALLOW_DESTRUCTIVE_COMPOSE=1`.

## Freshness — a stale worktree base is a landmine

`main` moves fast. A topic worktree created days ago and never refreshed sits on an old base. That base carries files that have since moved on `main` (a since-migrated baseline, for example), which surface as modify/delete conflicts only at PR time — and it makes the checkout's `merge-base` with `origin/main` disappear on a shallow clone.

Before serious implementation: `git fetch origin main`, confirm your base is current, rebase if not. The `SessionStart` `worktree-freshness` hook (`scripts/hooks/worktree-freshness.{sh,ps1}`) prints a warning automatically when it detects a stale base; silence with `DPF_SKIP_WORKTREE_FRESHNESS=1`.

**A stale base also serves a stale RULEBOOK, which is the quieter half (BI-9A46E89C).** `CLAUDE.md` imports `AGENTS.md` **from the worktree**, so an agent on an old base is governed by a superseded copy of the operating contract — and cannot detect that from the inside, because the stale copy does not know it is stale. The consequence is not a merge conflict but a **false negative**: every "does this already exist?" check runs against the old tree, so a rule, principle, helper or guard that exists on `main` reads as absent, and the agent rebuilds or re-proposes what is already canonical. Measured 2026-09-16 on a worktree 835 commits behind: `AGENTS.md` had gained "A gate that could not run is not a verdict" (2026-09-05) and **24 kernel-principle files** had moved, none visible; that session rebuilt a helper that existed (`git-changed-files.mjs`) and proposed a principle that existed (`report-only-the-verdict-you-reached`). The hook therefore reports instruction-plane drift **independently of the commit-count threshold** — one commit can add a commandment — and names the false-negative consequence explicitly, because the commit count alone reads as "your code may conflict" and gets worked past. Review what moved with `git diff $(git merge-base HEAD origin/main) origin/main -- AGENTS.md docs/founder-kernel/wiki/principles`.

The durable fix is to create worktrees from a freshly-fetched `origin/main` in the first place.

## Root-clone freshness — the shared root must stay on current `main`

This is a *different* concern from worktree-base freshness above: peer worktrees junction `@dpf/*` workspace packages into the **shared root clone**'s source tree, so if the root clone's own checkout falls behind `origin/main`, `pregate-preflight` aborts with *"Stale root clone detected (BI-A900EA3F)"* for **every** worktree until the root is fast-forwarded — even worktrees whose own branch is perfectly current.

The `SessionStart` `root-clone-freshness` hook (`packages/dpf-skill-pack/hooks/root-clone-freshness.mjs`) fast-forwards the root clone to `origin/main` automatically at session start — **fast-forward only**, and only when the root is on `main`. It **refuses** (and prints an advisory) when the root is off-main or detached, because work may be stranded there and a forced move would corrupt it. Uncommitted files do not block it unless the incoming commits change one of them. A dirty file nothing upstream touches is carried across unchanged; an overlapping one is named in the refusal (BI-F676CC23 — one bootstrap-written `.mcp.json` used to freeze the root for days). Run it by hand any time with `node scripts/root-clone-refresh.mjs [--json]`; silence the hook with `DPF_SKIP_ROOT_CLONE_REFRESH=1`. This runs the same safe `git merge --ff-only origin/main` that the stale-root-clone detector already recommends, so it never conflicts with the root-clone delete/mutation guard.

## Reaping safety — a live session's worktree is never reaped

The worktree janitor (`scripts/worktree-janitor.mjs`, fleet backstop; and the SessionEnd reaper) removes merged+clean worktrees. Two safety rails keep it from removing a worktree out from under work:

The SessionEnd reaper (`scripts/hooks/session-reaper.sh`) also terminates the ending session's own node sidecars and releases the leases that session owns. It is scoped on purpose: a process counts as the session's only when its command line names the session's worktree *outside* `node_modules` (shared binaries prove nothing about ownership) and names no other worktree; and a lease is released only when its `ownerSessionId` is the ending session. A session started in the root clone therefore never reaps a sibling worktree's local-CI gate run, which is how three gate runs died by SIGTERM on 2026-09-06 (BI-B0122A22).

- **Live-session gate.** A session writes a gitignored `.dpf-session-heartbeat.json` marker into its worktree, refreshed every turn by the `worktree-session-heartbeat` hook (SessionStart/Stop) and removed on SessionEnd. The janitor treats a fresh marker (TTL default 60 min, `DPF_WORKTREE_SESSION_HEARTBEAT_TTL_MIN`) as `KEEP`, **outranking** Tier-A eligibility — because a live session's tree first becomes Tier-A the moment its own PR merges, which is exactly when it must not be reaped.
- **Workroom ownership is read in full or not at all.** The janitor reads every page of one `list_workrooms` observation. A row without a provable `worktreePath` is resolved through its own `get_workroom` detail read, and an expired observation is restarted rather than mixed with a new one. Any incomplete read keeps every ownership-dependent tree, and the `--json` report's `claims.reason` says why (BI-83345811). See the [janitor schedule guide](../install/worktree-janitor-schedule.md#who-owns-a-worktree-bi-83345811).
- **Abandoned-merge quarantine.** A worktree with `MERGE_HEAD` present and **no** live session is classified `FLAG_ABANDONED_MERGE`: surfaced in the janitor summary and never auto-reaped, since an interrupted merge can hide un-reconciled work. A *live* session's in-progress merge is kept, not flagged.
- **Unpushed-work backup.** Before a live run deletes a stale, unmerged branch (bash stale prune, or Node Tier B), it counts commits on no remote (`git rev-list --count refs/heads/<b> --not --remotes`). If any exist it writes `refs/janitor-backup/<YYYY-MM-DD>/<b>` at the tip and logs it; if that count or ref write fails, the worktree is kept (BI-EBBBDF40). Recover with `git branch <b> refs/janitor-backup/<date>/<b>`.

## Branches left without a worktree

The janitor deletes a branch only together with the worktree it removes, so a branch whose tree went some other way stays forever. `scripts/branch-reaper.mjs` (BI-88D75BA3) inventories those branches. Local deletion remains incomplete.

- **Dry run by default.** `node scripts/branch-reaper.mjs` classifies and reports; `--live` prunes remote-tracking refs and reports local deletion as blocked (exit 3) when candidates exist; `--json` gives the full report.
- **What it classifies as eligible.** A local branch whose work is already on `origin/main`: either an ancestor of it, or exactly the head commit a PR shipped into main whose merge commit is reachable from the observed main history (squash merge). The branch must also have no worktree, no open PR and no live Workroom, and must not be the current, `main`, `release/*`, `hotfix/*` or a pinned branch. Pin a branch by adding its name as a line in `<git-common-dir>/dpf-branch-pins`.
- **Fails closed.** Missing exact branch identities, failed Git ownership reads, or an unreadable, malformed or limit-saturated open-PR inventory cannot authorize deletion. The observation must be installation-wide: an OAuth client credential sees only caller-visible rooms, so run it with the install's PAT. It reads branches only (`resolvePaths: false`) with a long read budget, because a large install's observation takes minutes.
- **Local deletion gate.** A complete snapshot and a tip comparison do not protect a new claim or checkout admitted after observation. The executable deletion path returns `concurrent-ownership-fence-unavailable` and performs zero local-ref mutations. There is no override flag. BI-88D75BA3 stays open until admission and deletion share a verified ownership reservation.
- **Each live cycle also** runs `git fetch --prune origin`, so remote-tracking refs for deleted remote branches go too.
- **Stash census.** It reports the stash: entry count, how many are older than 7 or 30 days, and the oldest. It never drops an entry, because the stash stack is repository-wide and holds other sessions' work.

## Rebasing on a shallow clone — never a bare `git rebase origin/main`

⟦runtime: precondition — shallow checkouts only; on a full clone the phantom replay does not occur⟧

This checkout is shallow (`git rev-parse --is-shallow-repository` → `true`), so a stale branch has no visible merge-base with `origin/main`. A bare `git rebase origin/main` then tries to replay *thousands* of phantom commits, starting from the repo's Initial commit, and unwinds your working tree.

- If a rebase ever balloons far past your own commit count, **`git rebase --abort` immediately**. Your committed and pushed commits are safe.
- Replay only your own commits: `git rebase --onto origin/main <the-commit-you-branched-from>`.
- Trust `gh pr view <n> --json files,additions,deletions` for true PR scope over a local `git diff HEAD origin/main`, which compares unrelated shallow trees.

## Housekeeping

If `SessionStart` prints `DPF HOUSEKEEPING DUE`, run it. The `janitor-throttle` hook (`scripts/hooks/janitor-throttle.{sh,ps1}`) fires at most once per 24h across all worktrees. Comply; don't skip silently. Details are in the hook's own header comment.

## When a worktree is removed

Three paths remove a worktree, and all three end at the same classifier so they cannot disagree:

1. **SessionEnd hook** (`worktree-session-hygiene.mjs`) — the primary path. Reaps *this session's* tree when it is Tier A. It cannot help when the PR merges after the thread ends, which is the normal case.
2. **Merge event** (`build/pr-merged-reap`, BI-848360EF) — runs the janitor scoped to the merged branch with `--branch`. This is the path that covers the gap above.
3. **Daily fleet sweep** (`worktreeJanitor`, 05:40) — the backstop for leftovers after a crash, and for clients that write no heartbeat.

Every one of them calls `classifyWorktree`, so a live session heartbeat, an active Workroom claim, `.worktree-pinned`, an active lease, an open PR or a dirty tree refuses the reap regardless of which path asked. A Workroom claim counts only while the room is non-terminal and the server's liveness verdict does not mark it reapable (`isReapable` on `list_workrooms`); a missing or shortened verdict keeps the claim (BI-CAA84E43).

Removal always goes through the junction-safe helper. A worktree here carries roughly 28 junctions into the root clone's `node_modules` and `apps/web/node_modules/*`; a recursive delete that follows one destroys the root clone's dependencies, which is what happened on 2026-08-15. Unlink each reparse point first, verify none remain, and only then remove the tree.

## Task-specific operating rules

- **All changes land via PR against `main`, DCO-signed, scoped to one clean revert.** Including the maintainer's. Topic branches named by intent: `feat/`, `fix/`, `chore/`, `doc/`, `clean/<slug>`, from `main`. → [kernel principle](../founder-kernel/wiki/principles/one-concern-per-pr.md)
- **Always push after committing.** Local-only commits are invisible to CI. → [kernel principle](../founder-kernel/wiki/principles/always-push-after-committing.md)
- **PR creation means ready to merge.** A pushed branch — not a PR — is the handoff/recovery artifact while work is in flight. No draft PRs, no `--draft`. Open only when the build gate is green and the author believes it is mergeable. → [kernel principle](../founder-kernel/wiki/principles/all-changes-land-via-pr.md)
- **Merge via the merge queue**, never by hand: `gh pr merge <n> --squash --auto`.
- **Verify merge-readiness mechanically** — `pnpm pr:health [<n>]`, never a visual scan of some checks.
- **One thread = one branch + one worktree**, in the dedicated sibling base. Never share a working tree across sessions. Implement and commit from the worktree — it is source-control isolation only (§1), so harness friction inside one is a harness limitation, not a product defect. → [kernel principle](../founder-kernel/wiki/principles/worktree-per-session.md)
- **Keep the root clone as the merge/release worktree** — read-only for active feature work. → [kernel principle](../founder-kernel/wiki/principles/keep-root-clone-as-merge-worktree.md)
- **Branch guard before implementation and commit:** never build on `HEAD (no branch)` or `main`. Completion requires a pushed branch or PR. → [kernel principle](../founder-kernel/wiki/principles/branch-guard-before-implementation.md)
- **Refresh a stale worktree base before serious implementation** (`git fetch origin main`), and **never run a bare `git rebase origin/main`** on this shallow clone — see the runbook for the recovery.
