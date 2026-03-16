# Agent Guardrails

## Live State vs Seed Data

- For any request about current epics, backlog, users, roles, capabilities, or status, query the live database first.
- Treat `packages/db/src/seed.ts` as bootstrap defaults only, not runtime truth.
- Only use seed content when the user explicitly asks about bootstrap data, migrations, or initial setup behavior.
- If live DB access fails, state that clearly and label any fallback output as a seed/default snapshot, not live state.

## Mutation Safety

- Do not edit `seed.ts` to represent day-to-day runtime changes.
- Runtime workflow changes should be made through app actions, migrations, or direct DB operations as appropriate.

## Branching & Workflow

### Core Rule

- **Work directly on `main`.** Do not create feature branches or worktrees unless the user explicitly asks for one.
- Commit early, commit often. Small, focused commits on `main` are preferred over long-lived branches.

### Why

- Worktrees and feature branches caused lost uncommitted work across multiple directories.
- This is a single-developer project where `main` is the working branch.
- Simplicity beats process overhead — if something breaks, `git revert` is straightforward.

### Commits

- Commit completed work promptly so nothing is lost.
- Use descriptive commit messages that explain *why*, not just *what*.
- Do not batch unrelated changes into a single commit.

### When to Branch (exception, not default)

- Only create a branch if the user explicitly requests one.
- Only create a branch for experimental work the user wants to isolate.
- If a branch is created, merge or discard it quickly — do not let branches linger.

### Verification

- Run `pnpm typecheck` before claiming work is complete.
- If a migration was added, verify it applies cleanly.
- Do not claim a feature works without testing it.

### Communication

- If uncommitted changes exist, mention them before starting new work.
- When committing, list what's included so the user can verify.
