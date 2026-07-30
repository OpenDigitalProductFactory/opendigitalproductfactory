## Summary

<!-- One paragraph: what does this change do and why? -->

## Changes

<!-- Bullet list of concrete changes. Keep them skimmable. -->

-
-

## Test plan

<!--
  Thread worktrees are source-control isolation, not runtime isolation.
  Source-only checks can run in the worktree; runtime-bound checks should
  run against the canonical local install or a governed shared nonprod
  environment. See AGENTS.md §5 and
  docs/founder-kernel/wiki/principles/worktree-is-source-control-not-runtime.md.
  Do NOT spend time making a thread worktree into a full DPF runtime
  unless that is the object of this PR.
-->

- [ ] **Source-only change** (types, isolated unit logic, doc, schema-only)
  - [ ] `pnpm typecheck` (worktree OK)
  - [ ] Targeted unit tests (worktree OK; name the file(s) run)

- [ ] **Runtime-bound change** (server route, MCP tool, build/runtime wiring, compose, installer, prisma migration, UX surface)
  - [ ] Source checks above passed where they can run in the worktree
  - [ ] Functional verification ran against the **canonical runtime** — pick one:
        - [ ] root local install (`http://localhost:3000`)
        - [ ] governed shared nonprod env (lease id: ____)
        - [ ] CI workflow run (link: ____)
  - [ ] Evidence captured below (command + observed output, screenshot, MCP record id, etc.)

- [ ] **Verification-harness limitation acknowledged** (check if any worktree-side gate was skipped because the worktree is not a full runtime; do NOT classify this as a product defect — file a platform BI instead)

### Verification evidence

<!-- Paste the exact canonical-runtime evidence: command, output snippet, screenshot link, MCP evidence record, or CI job URL. -->

## Pre-PR readiness

<!-- Complete these before creating the PR. A pushed branch is the handoff artifact while any item remains open. -->

- [ ] `pnpm gate:context` reviewed before implementation and again against the final diff
- [ ] `pnpm run pregate:preflight` passed before requesting a shared-sandbox lease
- [ ] Exact-tree local-CI evidence captured with `pnpm run pregate`, or an allowed `Local-CI-Override` is documented below
- [ ] `pnpm pr:ready -- --pr-body-file <this-body-file>` returned `PR readiness: READY` after the final push

<!-- Add exactly one when applicable:
Local-CI-Evidence: <evidence-record-id> (<branch>@<sha>)
Local-CI-Override: <allowed reason>
-->

## Related issues / Epic

<!-- Link issues this PR closes or relates to. Use "Closes #123" to auto-close on merge. -->
<!-- For large epics (e.g. EP-GROK-001), list the parent epic and the specific child BIs this PR covers. -->

## Epic / Backlog linkage (for multi-BI work)

<!-- Example for Grok epic:
Parent: EP-GROK-001: First-class Grok support
This PR covers: BI-GROK-006 (partial), ...
-->

## Overlap sweep

<!-- `gh pr list --state open --limit 50` result + any coordination notes. -->

## Notes for the reviewer

<!-- Flag anything non-obvious: migrations, config changes, breaking behavior, follow-up work. -->
