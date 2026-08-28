---
name: dpf-systematic-debugging
description: "Use when a DPF symptom needs a root cause — a failing build, a wedged runtime, a stuck job, wrong output."

# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash Grep Glob mcp__dpf__search_code_graph mcp__dpf__get_build_progress_visibility mcp__dpf__get_build_sandbox_state mcp__dpf__diagnose_sandbox mcp__dpf__list_work_capsules

# DPF coworker fields (Surface B — in-portal seed loader)
category: governance
assignTo: ["build-specialist", "platform-engineer", "external-coding-agent", "software-engineer"]
capability: null
taskType: research
triggerPattern: "debug|root cause|why is .* failing|stuck|wedged|not working|broken|reproduce the bug|investigate the (failure|error)"
userInvocable: true
agentInvocable: true
allowedTools: ["Bash", "Grep", "Glob", "mcp__dpf__search_code_graph", "mcp__dpf__get_build_progress_visibility", "mcp__dpf__get_build_sandbox_state", "mcp__dpf__diagnose_sandbox", "mcp__dpf__list_work_capsules"]
composesFrom: ["dpf-evidence-before-diagnosis", "dpf-verify-substrate-first"]
contextRequirements: []
riskBand: low

# Kernel principle enforcement
enforces:
  - kernel/principles/evidence-before-diagnosis
  - kernel/principles/structural-verification-is-not-functional
  - kernel/principles/check-tool-signals-first
  - kernel/principles/no-assumptions
  - kernel/principles/propose-acknowledge-reassign
---

# DPF Systematic Debugging

Hypothesis-and-isolate is assumed, not taught. In DPF the failure modes are substrate- and concurrency-shaped rather than logic-shaped, so the generic loop misleads more often than it helps. What follows is only the DPF-specific gating.

## When to use

- A build, job, or runtime is failing, stuck, or wedged and you need the root cause.
- Output is wrong and you are about to name a cause.
- A shared resource (portal, sandbox, queue, DB) appears "broken."

Skip it when you already have verified evidence of the cause, or when the "cause" is hypothetical with no observed symptom.

## Gate 1 — Live evidence before any hypothesis

**Hard gate: [`dpf-evidence-before-diagnosis`](../dpf-evidence-before-diagnosis/SKILL.md).** A log line saying "X failed because Y" is a hypothesis written by code that can itself be wrong — not a finding. Query the live state that would confirm or refute it:

- Live Postgres rows (`docker exec dpf-postgres-1 psql -U dpf -d dpf -c "…"`) — the actual record, not the log's claim about it.
- MCP status/tool signals (`tools/list`, build and sandbox status tools) — `check-tool-signals-first`.
- Container logs (`docker logs <svc>`), plus the relevant status route or run table (`QuiescenceRun`, `SelfUpgradeRun`, `FeatureBuild.buildExecState`).
- `get_build_sandbox_state`, `diagnose_sandbox`.
- `~/.dpf/install-state.json` and the deployed build identity when the symptom is install- or version-shaped.

Write down observed facts — numbers, timestamps, statuses — separately from any suggested cause.

> **Substrate anchor:** runtime-bound reproduction (running a service, testing against a live DB, exercising a build flow) belongs in the shared local-CI convergence sandbox, not a worktree. Kernel principle `worktree-is-source-control-not-runtime`; [AGENTS.md §3](../../../../AGENTS.md).

## Gate 2 — Concurrency and substrate, before declaring it broken

1. **Peer-session check (`propose-acknowledge-reassign`).** Before concluding a shared substrate is broken, check whether another session, worktree, or agent is already on it: `list_work_capsules`, `git log` for very recent commits, running build/compose processes, other worktrees. A peer may have the fix in flight, and re-fixing collides.
2. **Substrate verification ([`dpf-verify-substrate-first`](../dpf-verify-substrate-first/SKILL.md)).** Before "the component is missing," sweep `search_code_graph` plus a main-branch check. It usually exists; the wiring or the version is what is off.

## Gate 3 — Fix, then verify functionally

**Hard gate: `structural-verification-is-not-functional`.** A fix that compiles, type-checks, or lints is **not verified**. The symptom is fixed when the running thing behaves: the build goes green, the job completes, the row reaches the expected status, the endpoint returns the right value. A green typecheck on a wedged runtime is not a fix.

## Worked example (2026-05-30 — stuck quiescence drain)

The portal refused all MCP writes with `portal_quiescing`. Tempting diagnosis: "the quiescence logic is broken, go fix it."

- **Gate 1:** `QuiescenceRun` showed `status=draining`, `enteredStateAt.draining` 11+ minutes against a `budgetMs` of 300000, and `lastHeartbeatAt=null`. Observed fact: the coordinator never ran a single drain-tick. That refuted "logic bug in the wait loop" and pointed at "the coordinator never resumed."
- **Gate 2:** `ps` and `git log` showed a peer session had **already committed the fix** (`bcaa30a8`) and was rebuilding. Re-fixing would have collided in the shared tree.
- **Gate 3:** recovery was not "the code compiles" — it was the portal restarting on the fixed image and `quiescence-state` returning `level: normal` with MCP accepting a write.

Without gates 1 and 2, the obvious-but-wrong move — rewriting the quiescence logic — would have wasted effort and stepped on a peer.

## Guardrails

- **Never adopt a log's suggested cause as a finding.** Confirm against live state.
- **Never declare shared substrate broken without the peer check.**
- **Never report "fixed" on a structural pass.** Functional evidence or it is not fixed.
- **Keep observed facts separate from inferred causes** in notes and in the report.

## See also

- Predecessor gate: [`dpf-evidence-before-diagnosis`](../dpf-evidence-before-diagnosis/SKILL.md)
- Composes with: [`dpf-verify-substrate-first`](../dpf-verify-substrate-first/SKILL.md)
- Kernel: `evidence-before-diagnosis`, `structural-verification-is-not-functional`, `check-tool-signals-first`, `propose-acknowledge-reassign`.
