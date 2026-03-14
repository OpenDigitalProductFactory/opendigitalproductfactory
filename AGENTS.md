# Agent Guardrails

## Live State vs Seed Data

- For any request about current epics, backlog, users, roles, capabilities, or status, query the live database first.
- Treat `packages/db/src/seed.ts` as bootstrap defaults only, not runtime truth.
- Only use seed content when the user explicitly asks about bootstrap data, migrations, or initial setup behavior.
- If live DB access fails, state that clearly and label any fallback output as a seed/default snapshot, not live state.

## Mutation Safety

- Do not edit `seed.ts` to represent day-to-day runtime changes.
- Runtime workflow changes should be made through app actions, migrations, or direct DB operations as appropriate.

## Multi-Agent Workflow

### Core Rule

- Never do feature work directly on `main`.
- Keep `main` as the local mirror of `origin/main` as much as possible.

### Branching

- Each agent must work on its own feature branch.
- Branch names should be descriptive, for example `feature/identity-governance-foundation` or `feature/ea-reference-model-assessment-foundation`.
- Use a separate git worktree for each active feature branch.

### Worktrees

- Create a dedicated worktree for each agent branch under `.worktrees/`.
- Do not reuse another agent's worktree.
- Do not mix unrelated feature work in the same worktree.

### Local Integration

- If multiple feature branches need to be tested together locally before push, do not merge them into `main`.
- Create a local integration branch instead, for example `integrate/local-2026-03-13` or `integrate/<topic>`.
- Merge the selected feature branches into that integration branch for local testing.
- Run the app, migrations, tests, and typechecks from the integration branch.
- Only keep the integration branch as long as needed for combined validation.

### PR Workflow

- Verify each feature branch in isolation before pushing.
- Prefer opening PRs from feature branches, not from `main`.
- Only merge feature work into local `main` when the user explicitly wants local in-place integration.
- If local `main` must be updated while there are local changes, preserve those changes first with a stash or commit.

### Syncing Main

- Before starting new feature work, update `main` from `origin/main`.
- If local `main` has diverged because of local-only integration work, do not hide that fact. State it clearly before pulling or merging.
- If the user wants to keep local experimental changes, prefer a new integration branch over continuing to drift `main`.

### Verification

- Run branch-level verification in the feature worktree before claiming completion.
- If work is being integrated locally across multiple branches, run a second verification pass on the integration branch.
- Do not claim a feature is visible in `main` unless it has actually been merged into local `main` or the user is running from the feature branch/worktree.

### Communication

- Tell the user whether they are looking at `main`, a feature worktree, or an integration branch when that affects what they can see in the portal.
- When creating a PR, state whether the feature is only in the branch/PR or already present in local `main`.
