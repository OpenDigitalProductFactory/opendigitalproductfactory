# Implementation Plan — Thread Governance Conformance

- **Date:** 2026-08-22
- **Umbrella BI:** BI-299C953D
- **Design:** [2026-08-22-thread-governance-conformance-design.md](../specs/2026-08-22-thread-governance-conformance-design.md)
- **Epic:** EP-5560770F
- **Workroom:** WC-0D395540

Phases are ordered by dependency. Each phase is one PR, one concern. Phases 1–3 are the load-bearing chain and should land in order; 4–7 are independent once the chain is restored.

---

## Phase 1 — Restore governed MCP in every worktree (BI-90585312)

**Why first:** without MCP, no later phase can be verified — a thread cannot claim a workroom or record evidence. This unblocks everything.

1. Move the bearer token to a location the *client process* resolves, not just a login shell. Candidates in preference order: an `env` block in `.claude/settings.json` sourced from the managed toolchain file; `launchctl setenv` for GUI-launched clients; the client's native credential store where one exists.
2. Remove the hardcoded literal `dpfmcp_…` from the `~/.claude.json` root-clone project entry once the general path works — it currently masks the defect for exactly one path.
3. Change the bootstrap's token check from *env presence* to an **authenticated call** that asserts HTTP 200. Today it prints "MCP token: present" from a shell that has the variable, which is a false green.
4. Extend `sync-mcp-worktrees` to repair existing worktrees.

**Verification:** authenticated `tools/list` returns 200 from a client session (not a shell) in a worktree; the SessionStart health hook stops reporting the token unset.
**Rollback:** revert the settings change; the hardcoded root-clone entry keeps the merge worktree working.

---

## Phase 2 — Shared conformance module + honest banner (BI-21B04901)

1. Add `packages/dpf-skill-pack/hooks/lib/thread-conformance.mjs` computing the five steps with `pass|fail|unknown`, `failurePolicy`, and a remediation string each. Unit-test each check including the `unknown` path.
2. Add the work-shape SessionStart hook that renders the block, showing a remediation for the first unmet step only.
3. Demote or fold the six existing SessionStart hooks beneath it so the first thing a thread sees is the work shape.

**Verification:** vitest over the module; a session in a deliberately non-conformant worktree prints the expected block with the correct first-unmet step.
**Rollback:** hook is additive; remove the SessionStart entry.

---

## Phase 3 — Hook-injected doctrine + load assertion (BI-E659ED37)

Implements kernel decision DI-48014BCBA44F.

1. SessionStart hook resolves the canonical rulebook from the **installed skill pack**, not the checked-out branch, and injects it as additional context.
2. Assert the load and expose the result as conformance step 2, so a failure is visible rather than silent.
3. Keep the repo `CLAUDE.md` `@AGENTS.md` pointer as the fallback for surfaces without a hook plane.
4. One-off backfill of the 70 stale worktrees' `CLAUDE.md` — cleanup, not the mechanism.

**Verification:** a session in a worktree on a pre-#4477 branch reports doctrine loaded and can cite a §12 rule; the same worktree with the hook disabled reports step 2 failed rather than passing silently.
**Rollback:** disable the injection hook; the pointer fallback remains.

---

## Phase 4 — Workroom claim guard (BI-865E1755)

1. `workroom-claim-guard.mjs`, PreToolUse, matchers `Write|Edit|MultiEdit` **and** `Bash` (the Bash matcher is required — bypass mode routes edits around `Write|Edit` hooks).
2. Deny when no live capsule claims this worktree; message names the exact call. Read-only tools never gated.
3. Teach `dpf-worktree-per-session` and `worktree-create.mjs` to claim, so the guard is a backstop rather than the primary path.
4. Implement the documented bypass door: attributed, recorded as workroom evidence, surfaced in the banner as ungoverned.

**Verification:** an edit in an unclaimed worktree is denied with the remediation; after claiming, the same edit proceeds; the Bash path is denied identically.
**Rollback:** remove the hook entry.

---

## Phase 5 — Canonical worktree base enforcement (BI-076BCD26)

1. Deny or transparently redirect tool-native `.claude/worktrees` creation to the canonical sibling base.
2. Reconcile the 24 existing nested worktrees — adopt to the canonical base or reap.

**Verification:** native worktree creation lands in the canonical base; `ls .claude/worktrees` is empty or fully reconciled.

---

## Phase 6 — Workroom API work-shape fixes (BI-29673B7C, BI-5A1B0D36)

1. Make the correct sequence the only one that works: either `create_workroom` accepts the branch/worktree binding, or `adopt_worktree` accepts an existing `capsuleId` and binds instead of creating. (Reproduced during this very program — the documented sequence minted a duplicate capsule.)
2. Conflict granularity: a directory edit claim must not block a non-overlapping file claim, or directory-level edit claims are disallowed in favour of file/module claims.
3. Reject or namespace container-path worktree bindings (`/root/dpf-worktrees/…`) so a container capsule cannot hold a lease that blocks host work.
4. Surface `force=true` co-claims to the operator, not only in an activity row.

**Verification:** the documented sequence produces exactly one capsule; two workrooms can hold distinct files under one directory; a container path is rejected or namespaced.

---

## Phase 7 — Cross-surface guard liveness + CI backstop (BI-E8E7FCDF)

1. Liveness probe that proves a guard **actually denies** on each surface, rather than that it is installed.
2. Report any surface that cannot prove denial as **ungoverned** in the banner.
3. Run the same conformance checks in the cloud merge queue, so a fail-open local surface cannot land ungoverned work. This is the pre-commit-style backstop from the design's benchmarking section and is what makes the Codex trust gap survivable.
4. Operator-attested trust state for Codex pending upstream openai/codex#21615.

**Verification:** probe returns deny-proven for Claude Code and Grok; Codex reports its true state; CI rejects a branch that fails conformance.

---

## Sequencing note

Phase 1 is a hard prerequisite for verifying 2–7. Phases 4 and 5 must not land before 2 and 3: enforcing a rule the thread has not been told about, in a session that cannot see why it was denied, is the failure mode this program exists to remove. Enforcement follows legibility, never precedes it.

---

## Plan → backlog coverage

`record_plan_backlog_coverage` was called against BI-299C953D at commit
`979aece0737e1f65b61b484e3a84cad3e4b2f3c8` and was **refused**:

> BacklogItem BI-299C953D has no initiative scope baseline, so plan coverage cannot be
> bound to a governed scope. The baseline is recorded as an `initiative_scope_baseline`
> activity when the initiative's spec-approval gate passes; it is not currently reachable
> from an MCP session.

That is the known provenance defect **BI-B9403248** — the baseline an MCP caller is required
to have cannot be created from an MCP session. Per the tool's own remediation, the coverage
table is recorded here and the blocked receipt cites BI-B9403248. **No coverage receipt
exists for this plan**; do not report one.

| Phase | Deliverable | BI | Independently shippable | Depends on |
|---|---|---|---|---|
| 1 | Restore governed MCP in every worktree | BI-90585312 | yes | — |
| 2 | Shared conformance module + work-shape banner | BI-21B04901 | yes | phase 1 |
| 3 | Hook-injected doctrine + load assertion | BI-E659ED37 | yes | phase 2 |
| 4 | Workroom claim guard (Write/Edit + Bash) | BI-865E1755 | yes | phases 2, 3 |
| 5 | Canonical worktree base enforcement | BI-076BCD26 | yes | — |
| 6a | Bind existing workroom to a worktree | BI-29673B7C | yes | — |
| 6b | Scope granularity + container-path bindings | BI-5A1B0D36 | yes | — |
| 7 | Cross-surface guard liveness + CI backstop | BI-E8E7FCDF | yes | phases 2, 4 |

Umbrella: **BI-299C953D**. Epic: **EP-5560770F**. Workroom: **WC-0D395540**.
Kernel decision for phase 3: **DI-48014BCBA44F**.
