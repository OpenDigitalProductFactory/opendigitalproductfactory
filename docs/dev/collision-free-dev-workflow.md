# Collision-Free Dev Workflow

**The one rule:** never do active feature/fix/doc work in the root clone (`~/dpf`).
Work in a per-session git **worktree**, and **commit + push frequently**.

This is the operational companion to the principles
[`keep-root-clone-as-merge-worktree`](../founder-kernel/wiki/principles/keep-root-clone-as-merge-worktree.md)
and [`worktree-per-session`](../founder-kernel/wiki/principles/worktree-per-session.md),
and the [`dpf-worktree-per-session`](../../packages/dpf-skill-pack/skills/dpf-worktree-per-session)
skill — made into a single command.

## Why the root clone eats your work

The root clone at the canonical path (`~/dpf`) is **shared release state**. It
is intentionally not an isolated development workspace:

1. **The self-upgrade loop owns canonical source refs.**
   `apps/web/lib/self-upgrade/prepare-source.ts` fetches upstream and prepares
   `dpf/install` in the isolated `.upgrade-workspace/` clone. When the install
   has no local content delta, it advances to the exact canonical upstream SHA;
   when private/local content exists, it creates an honest `--no-ff` merge.
   The prepared ref is pushed back to the host clone **ref-only**, so the
   operator's checked-out working tree is not reset. This isolation protects
   the root checkout, but self-upgrade still owns the clone as release source
   authority; feature work does not belong there.
2. **Other concurrent agent sessions.** Each one may `git checkout <its-branch>`
   and `git reset` the root to do its own work. Observed in the reflog as
   `checkout: moving from <branchA> to <branchB>` followed by `reset: moving to HEAD`.

An active checkout or reset by another actor can roll back or discard work that
lives only in the root's working tree. A **linked worktree has its own working
tree and HEAD**, so other sessions and release-ref movement do not touch it.
That is the whole fix.

## The workflow

```sh
# 1. Start an isolated session (off the freshest origin/main, MCP seeded):
./scripts/new-dev-worktree.sh <slug> [branch-prefix]      # default prefix: feat
#   e.g. ./scripts/new-dev-worktree.sh invoice-pdf-export fix

# 2. Move into it and work there — never in the root:
cd ~/dpf-worktrees/<slug>

# 3. Commit + push after every logical step (nothing should live only in a
#    working tree):
git add -A && git commit -s -m "…" && git push -u origin <prefix>/<slug>

# 4. Open the PR from the worktree, let CI run, merge.

# 5. Clean up when merged:
git -C ~/dpf worktree remove ~/dpf-worktrees/<slug>
```

`new-dev-worktree.sh` resolves the **true** root clone (via `git worktree list`)
even when invoked from inside another worktree, bases the new branch on
`origin/main`, places it at `~/dpf-worktrees/<slug>`, and runs
`seed-worktree-mcp.sh` so the `dpf` MCP connector and an isolated compose stack
work immediately.

## Rules of thumb

- **Root clone = merges/releases/inspection only.** Treat it as read-only. Return
  to it for `git pull` on main and to verify canonical state — not to edit.
- **Commit + push fast.** The durability boundary is the remote, not your disk.
  If a worktree is ever removed, a pushed branch loses nothing.
- **One worktree per concurrent task.** Don't reuse one worktree for two
  unrelated branches.
- **Recovery, if you ever edited the root and it got reset:** check
  `git stash list` (a cleanup may have stashed `-u`) and `git reflog` before
  assuming the work is gone — but the real fix is to not work there.

## What this is NOT

It does not change the self-upgrade. The self-upgrade is *correct* to own the
host clone's canonical release refs and use an isolated preparation workspace.
This workflow keeps **your** work out of that shared release authority.
