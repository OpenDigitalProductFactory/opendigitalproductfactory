# BI-9A8E85F4 — unified bootstrap worktree readiness repair

Backlog item: `BI-9A8E85F4` — Agent toolchain bootstrap does not create the documented worktree readiness files.

## Current-state evidence

- `AGENTS.md` documents `scripts/dpf-bootstrap-agent-toolchain.sh` as the single command a linked worktree should run to get MCP config, Compose isolation, and `.dpf-worktree-readiness.json`.
- `scripts/seed-worktree-mcp.sh` owns the actual `.env` / `COMPOSE_PROJECT_NAME` / readiness-marker implementation.
- Running `scripts/dpf-bootstrap-agent-toolchain.sh` in a fresh linked worktree converged agent/plugin wiring but did not create `.env` or `.dpf-worktree-readiness.json`; running `scripts/seed-worktree-mcp.sh` afterward repaired those files.
- A no-`node` PATH can still have a runnable `pnpm` wrapper, but lifecycle scripts fail unless the bundled Node `bin` directory is also on PATH.

## Plan

1. Add a `--core-only` mode to `scripts/seed-worktree-mcp.sh`.
   - Deliverable: seed script can write MCP config, Compose isolation, and readiness without invoking skill-pack/bootstrap recursion.
   - Verification: release contract test proves `--core-only` writes `.env`, `.mcp.json`, and `.dpf-worktree-readiness.json` even when `ensure-dpf-skill-pack.sh` would fail.

2. Make `scripts/dpf-bootstrap-agent-toolchain.sh` delegate linked-worktree metadata to the seed script.
   - Deliverable: bootstrap runs core seeding before toolchain work and refreshes it after normal or fallback completion.
   - Verification: static release contract asserts bootstrap calls `seed-worktree-mcp.sh --core-only` on pre-toolchain, post-toolchain, and post-fallback paths.

3. Harden POSIX bootstrap child-process PATH for bundled Node runtimes.
   - Deliverable: if `node` is absent but a known bundled Codex Node runtime exists, bootstrap prepends it so dependency lifecycle scripts can find `node`.
   - Verification: functional bootstrap run from a linked worktree without `node` on PATH adds the bundled runtime and completes far enough to recreate `.env` and readiness metadata.

## Risks and rollback

- Risk: accidental recursion between seed and bootstrap. Mitigation: `--core-only` skips skill-pack bootstrap.
- Risk: duplicate metadata logic. Mitigation: bootstrap delegates to the seed script rather than reimplementing `.env` / readiness generation.
- Rollback: revert this plan and the paired script/test changes; legacy `seed-worktree-mcp.sh` remains the manual repair path.

## Verification commands

- `PATH=/Users/markbodman/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH node --test tests/release/worktree-readiness-contract.test.mjs`
- Functional check in linked worktree:
  - remove `.env` and `.dpf-worktree-readiness.json`
  - run `bash scripts/dpf-bootstrap-agent-toolchain.sh`
  - verify `.env` contains non-root `COMPOSE_PROJECT_NAME`
  - verify `.dpf-worktree-readiness.json` exists and reports the current readiness state
