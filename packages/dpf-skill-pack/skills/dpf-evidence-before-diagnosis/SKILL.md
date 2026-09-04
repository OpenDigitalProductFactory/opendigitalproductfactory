---
name: dpf-evidence-before-diagnosis
description: "Use when about to claim a cause for a DPF symptom without having checked the live DB, status fields, logs, or runtime state."

# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash Grep mcp__dpf__get_backlog_item mcp__dpf__get_build_progress_visibility mcp__dpf__get_build_sandbox_state mcp__dpf__list_build_activity_since mcp__dpf__get_build_dispatch_history mcp__dpf__diagnose_sandbox

# DPF coworker fields (Surface B — in-portal seed loader)
category: governance
assignTo: ["build-specialist", "platform-engineer", "external-coding-agent", "software-engineer"]
capability: null
taskType: research
triggerPattern: "what's wrong|why is .* failing|why does .* not work|the cause is|looks like .* is broken|diagnose"
userInvocable: true
agentInvocable: true
allowedTools: ["Bash", "Grep", "mcp__dpf__get_backlog_item", "mcp__dpf__get_build_progress_visibility", "mcp__dpf__get_build_sandbox_state", "mcp__dpf__list_build_activity_since", "mcp__dpf__get_build_dispatch_history", "mcp__dpf__diagnose_sandbox"]
composesFrom: ["dpf-systematic-debugging"]
contextRequirements: []
riskBand: low

# Kernel principle enforcement
enforces:
  - kernel/principles/evidence-before-diagnosis
  - kernel/principles/structural-verification-is-not-functional
  - kernel/principles/check-tool-signals-first
  - kernel/principles/never-fabricate
---

# DPF Evidence Before Diagnosis

A log line says "X failed because Y." The agent reads it and reports "Y is the problem." **Stop.** Before naming Y as the cause, query the live state — DB row, status field, runtime ledger, tool return value — that would either confirm or refute the log's suggested cause. Logs are written by code that itself can be wrong; their suggested causes are hypotheses, not findings.

This skill is the DPF-specific operationalization of the `evidence-before-diagnosis` and `structural-verification-is-not-functional` commandments. It composes with `dpf-systematic-debugging` as the evidence-gathering step that comes before hypothesis testing.

## When to use

- A log line, error message, or status field suggests a cause and you're about to report it.
- A test failed and the failure message points at a likely cause.
- A coworker / agent claimed an action succeeded — verify the claim against state, don't take the report at face value.
- Operator describes a symptom ("X isn't working") and you're about to diagnose.
- About to claim "X is complete" or "Y is fixed" — verify functionally, not structurally.

## When NOT to use

- The "cause" is purely hypothetical (brainstorming candidate root causes) — that's `dpf-systematic-debugging` territory.
- Pure code review (no runtime state to verify against) — read for code-correctness directly.
- Operator has explicitly authorized speculative reasoning (rare).

## Read first

| Source | Path / tool | What to extract |
|---|---|---|
| Tool return values | The MCP / shell call that produced the suspicious output | Per `check-tool-signals-first` — the tool's structured return is the primary signal, not the log line that mentions it |
| Live DB state | `mcp__dpf__get_backlog_item`, `mcp__dpf__get_build_progress_visibility`, direct psql if needed | The current row state for any BI / FeatureBuild / SkillDefinition the symptom touches |
| Runtime ledger | `mcp__dpf__list_build_activity_since`, `mcp__dpf__get_build_dispatch_history` | Time-ordered evidence — when did the symptom start, what preceded it |
| Sandbox state | `mcp__dpf__get_build_sandbox_state`, `mcp__dpf__diagnose_sandbox` | Build sandbox health — disk, processes, recent stderr |
| Tool-trace logs | `[tool-trace]` log entries (per `project_tool_trace_logging`) | Durable trace; read before speculating about stuck agents |
| Code path | The function that wrote the log line | What conditions actually trigger this log emission |

## Enforces

- `kernel/principles/evidence-before-diagnosis` — this skill IS that principle, operationalized.
- `kernel/principles/structural-verification-is-not-functional` — code-in-bundle, tests-pass, 4xx-on-malformed-input do NOT prove the feature works.
- `kernel/principles/check-tool-signals-first` — don't blame the model; check tool return values.
- `kernel/principles/never-fabricate` — ground every causal claim in code, spec, or DB state.

## Steps

1. **State the symptom precisely.** Quote the exact log line, error message, or operator observation. Imprecise symptoms beget imprecise diagnoses.

2. **Check tool signals first.** If the symptom came from a tool call, look at the structured return — `success`, `error`, `message`, `data` — not just the prose log emitted around it. Per `feedback_check_tool_signals` and `project_proposal_trap_silent_failure`, the most common diagnosis failure is reading the chat message and missing the structured `success: true | false` field that contradicts it.

3. **Query live state for the suggested cause.** If the log says "X failed because Y is null," go check whether Y is actually null in the DB or the status field. If the log says "build stuck on phase Z," query `get_build_progress_visibility` to see what phase the build is actually in. Verify the cause before naming it.

4. **Look for a counter-example.** Search for a recent case where the symptom occurred and the named cause was NOT present — that disproves the cause. If you find one, the log is misleading and the real cause is elsewhere.

5. **Distinguish structural from functional verification.** Per `structural-verification-is-not-functional`:
   - Structural: code is in the bundle, types pass, route returns 4xx on malformed input. **None of this proves the feature works.**
   - Functional: you drove the happy path on the live install and observed the expected behavior. **This is the evidence the commandment requires.**

6. **Distinguish product defects from worktree-harness artifacts.** Before naming the cause of any runtime symptom observed inside a thread worktree, ask: did this symptom reproduce against the canonical local install (root clone, port 3000, shared dev DB)? Worktree-only symptoms have a known taxonomy of harness causes that are NOT product defects:
   - `pnpm: command not found` or corepack missing on the worktree PATH
   - Workspace package resolution pointing outside the worktree root
   - Prisma client absent because `prisma generate` only ran in the root clone
   - Next/Turbopack refusing a `node_modules` symlink that escapes the workspace
   - Docker/compose collisions when `COMPOSE_PROJECT_NAME` isn't isolated

   If the symptom only appears in the worktree, the diagnosis is "worktree harness limitation" — file a platform process BI if it's worth closing, and verify the product behavior against the canonical install. Do NOT report the symptom as a product failure unless you reproduced it on the canonical install. See [`worktree-is-source-control-not-runtime`](../../../../docs/founder-kernel/wiki/principles/worktree-is-source-control-not-runtime.md).

7. **Write the diagnosis as a structured report**, not screenshots (per `feedback_dynamic_analysis_is_evidence`). Structure: drove X, observed Y, signed off Z.

8. **Surface to operator** for ratification before mutating anything. Diagnoses can be wrong even when they're well-grounded.

## Output template

```
**Diagnosis (evidence-grounded).**

- Symptom: <exact quote>
- Tool signal: <structured return — success/error/data — or "n/a, not from a tool">
- Live-state query: <what was queried, what was found>
- Counter-example search: <none found, OR named case where cause was absent>
- Verification mode: <structural | functional (drove X, observed Y)>
- Cause (high confidence | hypothesis): <one sentence>
- Recommended action: <fix-target | escalate | further investigation needed>
```

If verification mode is structural and the symptom is "X is complete / fixed / working," explicitly say:

```
WARNING: structural verification only. The feature has not been driven functionally.
Per the structural-verification-is-not-functional commandment, this does NOT prove the
feature works. Recommend a functional verification pass before claiming complete.
```

## Guardrails

- **Never claim a cause from a single log line.** Always verify against live state.
- **Never claim completion based on tests-pass or build-pass alone.** Per the commandment, drive the happy path.
- **Never trust an agent / coworker's "I succeeded" report at face value.** Per `project_proposal_trap_silent_failure` and `project_hive_contribution_gaps`, success messages have been wrong frequently enough that verification IS the default, not the exception.
- **Never delete evidence before reporting.** Logs, tool returns, DB rows — preserve them in the report so the operator can audit.
- **Never paraphrase the symptom.** Quote it. Paraphrase introduces interpretation that may itself be wrong.
- Never diagnose a worktree-only symptom as a product defect without reproducing it on the canonical local install. Harness friction (pnpm PATH, workspace links, generated Prisma client, symlinked node_modules) is a known taxonomy of NOT-the-product causes.

## Worked example (this session, 2026-05-24)

During the BI-3C1A6451 (semantic-fallback fix) build gate, the full vitest run reported `Test Files 2 failed | 946 passed`. The two failing tests were `lib/mcp-tools-backlog.test.ts:75` and `lib/mcp-tools-sandbox-admin.test.ts:90`. The naïve diagnosis would have been: "my change broke these tests." This skill caught the trap:

1. **Symptom:** exact failure quote — `Error: Test timed out in 5000ms` at line `const { PLATFORM_TOOLS } = await import("./mcp-tools");`.
2. **Tool signal:** vitest's structured output showed both failures at the same 5000ms boundary on the same `await import("./mcp-tools")` line — same shape, same place.
3. **Live-state query:** my code change (mcp-tools.ts principle_decide case body) was inside a `case` block, not at module-import time. Module-import-time code path was untouched.
4. **Counter-example search:** isolated re-run of those same 2 test files with `--testTimeout=30000` from apps/web cwd: 25/25 pass in 1.47s. Same module import, more time → pass.
5. **Verification mode:** functional — re-running with longer timeout from correct cwd was the live verification.
6. **Cause:** pre-existing 5000ms-default test-timeout flake on the 11000-line dynamic import, surfaced under cold cache; NOT a regression from this fix.
7. **Action:** committed the fix anyway with the evidence in the commit message; flagged the test-timeout issue as a separate spawn-task chip so it doesn't get lost.

Had this skill been skipped, the diagnosis "my change broke these tests" would have been wrong, the fix would have been blocked or rolled back, and the real issue (test-runner default config) would have stayed buried.

## See also

- Kernel commandment: [`structural-verification-is-not-functional`](../../../../docs/founder-kernel/wiki/principles/structural-verification-is-not-functional.md)
- Kernel principle: [`evidence-before-diagnosis`](../../../../docs/founder-kernel/wiki/principles/evidence-before-diagnosis.md)
- Kernel principle: [`check-tool-signals-first`](../../../../docs/founder-kernel/wiki/principles/check-tool-signals-first.md)
- Composes with: `dpf-systematic-debugging` (4-phase root cause process)
- Memory: `feedback_dynamic_analysis_is_evidence` (dynamic-analysis output discipline)
- Memory: `project_proposal_trap_silent_failure` (success-message mistrust)
- Tool-trace logging: `project_tool_trace_logging` (`[tool-trace]` log entries to read first)
