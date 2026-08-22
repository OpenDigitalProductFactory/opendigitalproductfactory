---
name: dpf-systematic-debugging
description: "Use when a DPF symptom needs a root cause — a failing build, a wedged runtime, a stuck job, wrong output. Runs a 4-phase root-cause process, DPF-adapted: gather live evidence before any hypothesis, check whether a peer session/worktree is already acting on the same substrate before declaring it broken, verify the substrate before declaring something missing, and prove the fix functionally (a structural pass is not verification)."

# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash Grep Glob mcp__dpf__search_code_graph mcp__dpf__get_build_progress_visibility mcp__dpf__get_build_sandbox_state mcp__dpf__diagnose_sandbox mcp__dpf__list_work_capsules

# DPF coworker fields (Surface B — in-portal seed loader)
category: governance
assignTo: ["*"]
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

Generic debugging is "form a hypothesis, isolate the variable, test it." In DPF the failure modes are substrate- and concurrency-shaped, not just logic bugs, so the generic loop misleads more often than it helps. This skill runs the same four phases but puts DPF gates in front of each one. It replaces the retired upstream `systematic-debugging` skill, and it is the connective tissue across skills DPF already owns — [`dpf-evidence-before-diagnosis`](../dpf-evidence-before-diagnosis/SKILL.md) and [`dpf-verify-substrate-first`](../dpf-verify-substrate-first/SKILL.md).

## When to use

- A build, job, or runtime is failing/stuck/wedged and you need the root cause.
- Output is wrong and you are about to name a cause.
- A shared resource (portal, sandbox, queue, DB) appears "broken."

## When NOT to use

- You already have verified evidence of the cause and just need the fix — go implement it.
- The "cause" is still hypothetical with no observed symptom — that is design/brainstorming territory.

## The four phases (DPF-gated)

### Phase 1 — Reproduce + gather live evidence (before any hypothesis)

**Hard gate: [`dpf-evidence-before-diagnosis`](../dpf-evidence-before-diagnosis/SKILL.md).** A log line that says "X failed because Y" is a *hypothesis written by code that can itself be wrong* — not a finding. Before naming any cause, query the live state that would confirm or refute it:

- Live Postgres rows (`docker exec dpf-postgres-1 psql -U dpf -d dpf -c "…"`) — the actual record, not the log's claim about it.
- MCP status/tool signals (`tools/list`, build/sandbox status tools) — `check-tool-signals-first`.
- Container logs (`docker logs <svc>`), and the relevant status route or run table (e.g. `QuiescenceRun`, `SelfUpgradeRun`, `FeatureBuild.buildExecState`).
- Build Studio / sandbox state via `mcp__dpf__get_build_sandbox_state`, `mcp__dpf__diagnose_sandbox`.
- `~/.dpf/install-state.json` and the deployed build identity when the symptom is install/version-shaped.

Confirm the symptom reproduces and write down the *observed* facts (numbers, timestamps, statuses), separate from any suggested cause.

> **Substrate anchor:** runtime-bound reproduction steps (running a service, executing tests against a live DB, exercising a build flow) must run in the shared local-CI convergence sandbox, not in a worktree. See kernel principle `worktree-is-source-control-not-runtime` and [AGENTS.md §5](../../../../../AGENTS.md#5-worktree-hygiene).

### Phase 2 — Concurrency + substrate check (before declaring it broken)

Two DPF-specific traps live here:

1. **Peer-session check (`propose-acknowledge-reassign`).** Before concluding "this shared substrate is broken," check whether another session, worktree, or agent is already acting on it: `mcp__dpf__list_work_capsules`, `git log` for very recent commits, running build/compose processes, other worktrees. A peer may already have the fix in flight — re-fixing it collides. *(Worked example below.)*
2. **Substrate verification (`dpf-verify-substrate-first`).** Before "the component is missing/broken," sweep with `mcp__dpf__search_code_graph` + a main-branch check. The thing usually exists; the wiring or the version is what's off.

### Phase 3 — Hypothesis + isolation

Only now form hypotheses, ranked by the Phase-1 evidence. Isolate one variable at a time. Prefer the hypothesis the evidence already points at over the one that is easiest to test. Apply `no-assumptions`: state what you are assuming and confirm it before acting on it.

### Phase 4 — Fix + functional verification

**Hard gate: `structural-verification-is-not-functional`.** A fix that compiles, type-checks, lints, or passes a structural check is **not verified.** The symptom is fixed only when the *running thing* behaves correctly — the build goes green, the job completes, the row reaches the expected status, the endpoint returns the right value. Capture that functional evidence. A green type-check on a wedged runtime is not a fix.

## Worked example (2026-05-30 — stuck quiescence drain)

The portal refused all MCP writes with `portal_quiescing`. The tempting diagnosis: "the quiescence logic is broken, go fix it."

- **Phase 1 (evidence):** queried `QuiescenceRun` — the run had `status=draining`, `enteredStateAt.draining` 11+ minutes ago against a `budgetMs` of 300000, and `lastHeartbeatAt=null`. *Observed fact:* the coordinator never ran a single drain-tick. That refuted "logic bug in the wait loop" and pointed at "the coordinator never resumed."
- **Phase 2 (peer check):** `ps` + `git log` showed a peer session had **already committed the fix** (`bcaa30a8`) and was rebuilding the portal. Re-diagnosing and re-fixing would have collided in the shared tree.
- **Phase 4 (functional):** recovery wasn't "the code compiles" — it was the portal restarting on the fixed image and `quiescence-state` actually returning `level: normal` with MCP accepting a write. That observed behavior was the verification.

Without Phases 1-2, the obvious-but-wrong move (rewrite the quiescence logic) would have wasted effort and stepped on a peer.

## Guardrails

- **Never adopt a log's suggested cause as a finding.** Confirm against live state first.
- **Never declare shared substrate broken without the peer check.** Someone may be mid-fix.
- **Never report "fixed" on a structural pass.** Functional evidence or it isn't fixed.
- **Separate observed facts from inferred causes** in your notes and your report.

## See also

- Predecessor gate: [`dpf-evidence-before-diagnosis`](../dpf-evidence-before-diagnosis/SKILL.md)
- Composes with: [`dpf-verify-substrate-first`](../dpf-verify-substrate-first/SKILL.md)
- Kernel: `evidence-before-diagnosis`, `structural-verification-is-not-functional`, `check-tool-signals-first`, `propose-acknowledge-reassign`.
