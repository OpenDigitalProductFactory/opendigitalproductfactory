# DPF hook purposes

Generated from [hooks.json](hooks.json). Do not edit this reference by hand.

Before enabling a hook, match its event and command with the entries below.
Numbers follow definition order; your client may order entries differently.
The client owns the current trust state. This reference does not grant trust.

Purpose text is stored as `statusMessage`, which clients may show while a hook runs.
Friendly names in approval rows remain a [Codex client request](https://github.com/openai/codex/issues/31469).
A purpose in this file is not proof that an approval row displays it.


## PreToolUse

- Hook 1 [Bash]: [lease-guard.mjs](lease-guard.mjs) — Check the environment lease before starting a server
- Hook 2 [Bash]: [root-clone-guard.mjs](root-clone-guard.mjs) — Protect the shared source checkout from unsafe changes
- Hook 3 [Bash]: [compose-guard.mjs](compose-guard.mjs) — Protect shared services from destructive Compose commands
- Hook 4 [Bash]: [portal-image-guard.mjs](portal-image-guard.mjs) — Keep portal image changes on the verified release path
- Hook 5 [Bash]: [lease-punt-guard.mjs](lease-punt-guard.mjs) — Check runtime verification has a provisioned environment
- Hook 6 [Bash]: [pregate-evidence-guard.mjs](pregate-evidence-guard.mjs) — Check verification evidence before publishing code
- Hook 7 [Bash]: [pregate-invocation-guard.mjs](pregate-invocation-guard.mjs) — Check the verification command can run and report its result
- Hook 8 [Bash]: [workroom-claim-guard.mjs](workroom-claim-guard.mjs) — Check this source change belongs to a claimed Workroom
- Hook 9 [AskUserQuestion]: [decision-routing-guard.mjs](decision-routing-guard.mjs) — Check platform guidance before asking for a decision
- Hook 10 [Write\|Edit\|MultiEdit]: [root-clone-guard.mjs](root-clone-guard.mjs) — Protect the shared source checkout from unsafe changes
- Hook 11 [Write\|Edit\|MultiEdit]: [plan-backlog-coverage-guard.mjs](plan-backlog-coverage-guard.mjs) — Check planned deliverables are tracked before source edits
- Hook 12 [Write\|Edit\|MultiEdit]: [ux-fit-precheck.mjs](ux-fit-precheck.mjs) — Remind the author to review usability for UI changes
- Hook 13 [Write\|Edit\|MultiEdit]: [spec-plan-doc-precheck.mjs](spec-plan-doc-precheck.mjs) — Remind the author to include required design and documentation
- Hook 14 [Write\|Edit\|MultiEdit]: [design-grounding-precheck.mjs](design-grounding-precheck.mjs) — Remind the author to check existing design and implementation
- Hook 15 [Write\|Edit\|MultiEdit]: [tool-economy-precheck.mjs](tool-economy-precheck.mjs) — Remind the author to keep tool descriptions and results bounded
- Hook 16 [Write\|Edit\|MultiEdit]: [workroom-claim-guard.mjs](workroom-claim-guard.mjs) — Check this source change belongs to a claimed Workroom

## WorktreeCreate

- Hook 1: [worktree-create.mjs](worktree-create.mjs) — Create an isolated worktree in the shared worktree directory

## SessionStart

- Hook 1: [process-spine-health-check.mjs](process-spine-health-check.mjs) — Check required DPF skills are installed and exposed
- Hook 2: [governance-freshness-check.mjs](governance-freshness-check.mjs) — Check this checkout has current process guards
- Hook 3: [worktree-session-hygiene.mjs](worktree-session-hygiene.mjs) — Check worktree location and unused checkout inventory
- Hook 4: [worktree-session-heartbeat.mjs](worktree-session-heartbeat.mjs) — Refresh this session heartbeat to protect active work
- Hook 5: [root-clone-freshness.mjs](root-clone-freshness.mjs) — Safely fast-forward the clean shared source checkout
- Hook 6: [worktree-readiness-banner.mjs](worktree-readiness-banner.mjs) — Report which checks this worktree is ready to run

## SessionEnd

- Hook 1: [uncommitted-work-guard.mjs](uncommitted-work-guard.mjs) — Warn about uncommitted work before the session ends
- Hook 2: [worktree-session-heartbeat.mjs](worktree-session-heartbeat.mjs) — Remove the ended session heartbeat
- Hook 3: [worktree-session-hygiene.mjs](worktree-session-hygiene.mjs) — Reap this checkout only when merged, clean and no longer in use

## Stop

- Hook 1: [uncommitted-work-guard.mjs](uncommitted-work-guard.mjs) — Warn about uncommitted work before ending the turn
- Hook 2: [worktree-session-heartbeat.mjs](worktree-session-heartbeat.mjs) — Refresh this session heartbeat to protect active work

Regenerate with `python scripts/update_agent_toolchain.py --write-hook-reference` from the skill-pack directory.
