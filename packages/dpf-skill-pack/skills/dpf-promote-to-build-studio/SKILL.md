---
name: dpf-promote-to-build-studio
description: "Use when a DPF backlog item is triaged build and Build Studio is the right executor for it."

# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: mcp__dpf__promote_to_build_studio mcp__dpf__get_backlog_item mcp__dpf__process_backlog_for_build_studio mcp__dpf__list_build_activity_since mcp__dpf__get_build_progress_visibility

# DPF coworker fields (Surface B — in-portal seed loader)
category: build
assignTo: ["build-specialist", "ops-coordinator"]
capability: null
taskType: workflow
triggerPattern: "promote to build studio|send to BS|kick off the build|start build|hand off to build|BS pipeline"
userInvocable: true
agentInvocable: true
allowedTools: ["mcp__dpf__promote_to_build_studio", "mcp__dpf__get_backlog_item", "mcp__dpf__process_backlog_for_build_studio", "mcp__dpf__list_build_activity_since", "mcp__dpf__get_build_progress_visibility"]
composesFrom: ["dpf-file-backlog-item"]
contextRequirements: ["Build Studio runtime online; dpf MCP server reachable"]
riskBand: medium

# Kernel principle enforcement
enforces:
  - kernel/principles/architecture-over-shortcuts
  - kernel/principles/governance-approves-evidence-not-provenance
  - kernel/principles/worktree-is-source-control-not-runtime
---

# DPF Promote to Build Studio

Build Studio is one DPF delivery surface, not the mandatory route for all development. The current rule is: **choose the delivery surface by fit, and track the work centrally through the MCP/capsule/evidence plane.** File or adopt the BI/Workroom, record evidence, and ship through PR health whether the executor is embedded Build Studio or an external Claude Code / Codex / Grok host worktree.

This skill is the handoff for the subset of backlog work that should enter the embedded Build Studio pipeline: BI → promote → approve Ideate → let BS run. It is not a reason to stop in-session implementation when the operator has asked for work here, when BS is limited/degraded, or when the work is too large, complex, cross-cutting, or tool-sensitive for BS to handle well.

## When to use

- A backlog item is triaged with `outcome=build` and `effortSize` set.
- Build Studio runtime is online and has capacity.
- The work fits BS's current capabilities: bounded scope, clear brief, manageable context size, and no need for host-only tooling or long-running manual orchestration.
- The BI has a usable body (problem + scope + acceptance criteria); BS uses this as the brief.
- Operator has signaled "promote this to Build Studio" or you've reached the post-triage transition in an autonomous flow where BS is the recommended executor.

## When NOT to use

- BI is in `triaging` status — promote requires `outcome=build`. Triage first (`mcp__dpf__triage_backlog_item`).
- The operator asks to do the work in the current Claude Code / Codex / Grok session. Respect that and keep it centrally tracked through a Workroom/evidence/PR instead of force-routing to BS.
- Build Studio runtime is down, degraded, capacity-constrained, or too limited for the effort — do the work on an external host-worktree surface and reconcile evidence through MCP.
- The work is large/complex/cross-cutting, needs richer codebase navigation than BS has, or requires repeated human/agent judgement across many files. Central tracking still happens through the workroom plane; BS is not required for visibility.
- The work is operator-scope only (research, audit, decision) — those don't enter BS.
- The work is a coworker-skill addition (use `add-skill` coworker skill instead) or a kernel-page edit (use `draft-kernel-edit-pr`).
- The BI body is incomplete or vague — BS will Ideate it into a worse spec than you'd write yourself. Author the body fully via `dpf-file-backlog-item` first.

## Read first

| Source | Path | What to extract |
|---|---|---|
| BI state | `mcp__dpf__get_backlog_item({ itemId })` | Current status, triageOutcome, effortSize, body — promotion preconditions |
| BS runtime health | `mcp__dpf__list_build_activity_since` or the `/build` page | Whether the BS runtime is online and has capacity |
| BS pipeline phases | [`apps/web/lib/build/build-orchestrator.ts`](../../../../apps/web/lib/build/build-orchestrator.ts) | The lifecycle gates this BI will traverse (Ideate → Plan → Build → Verify → Ship) |
| Delivery-surface doctrine | [`AGENTS.md §12`](../../../../AGENTS.md#12-delivery-surfaces--execution-alignment) | BS is optional; external host-worktree builds are peers when centrally tracked |

## Enforces

- `kernel/principles/architecture-over-shortcuts` — choose the delivery surface that fits the architecture and evidence needs; don't force a limited executor for superficial consistency.
- `kernel/principles/governance-approves-evidence-not-provenance` — gates approve evidence quality, regardless of whether BS or an external host-worktree produced it.

## Steps

1. **Verify preconditions.** Call `mcp__dpf__get_backlog_item({ itemId })`. Check:
   - `status` is `open` (post-triage) — not `triaging`, not `done`, not `deferred`.
   - `triageOutcome` is `build`.
   - `effortSize` is set (small/medium/large/xlarge).
   - `body` is non-empty and includes the acceptance criteria.
   If any check fails, do NOT promote — return the user to the upstream skill (`dpf-file-backlog-item` for missing body; `mcp__dpf__triage_backlog_item` for missing triage).

2. **Check BS runtime health and fit.** Call `mcp__dpf__list_build_activity_since({ since: <ISO-2h-ago> })` to confirm the orchestrator is processing. If activity is dead for hours, the runtime may be down — surface to operator before promoting (a promoted BI sitting in a dead queue is worse than an unpromoted one). Also check scope fit: if the work is large/complex or likely to exceed BS's current abilities, keep it on an external host-worktree surface with workroom/evidence tracking.

3. **Call `mcp__dpf__promote_to_build_studio({ itemId })`.** The tool creates a draft `FeatureBuild` linked to the BI, sets the BI status appropriately, and writes the activity row.

4. **Watch for the Ideate phase output.** BS runs Ideate first — produces a refined brief. Use `mcp__dpf__get_build_progress_visibility` (or watch the `/build` UI) for the Ideate result. Per `feedback_build_studio_design_review_loop`, Ideate may fail strict design review on first pass; that's normal.

5. **Approve or refine.** When Ideate output is ready:
   - Approve → BS proceeds to Plan → Build → Verify → Ship.
   - Refine → operator sends feedback through the BS UI; Ideate re-runs.
   - Reject → BI returns to backlog; capture the rejection reason as evidence.

6. **Surface progress visibility.** Don't poll. Use `mcp__dpf__get_build_progress_visibility` once after promote, then let BS notifications drive the rest. Per `feedback_idle_is_not_abandoned` and `feedback_background_eval_probes`, BS work is async by design.

## Output template

```
**Promoted to Build Studio.**

- BI: `<BI-XXXXXXXX>` (<title>)
- FeatureBuild: `<FB-XXXXXXXX>` (auto-created by promote)
- Effort: <size>
- Current phase: ideate
- Next operator action: review Ideate output at /build/<FB-id>
```

If preconditions failed:

```
**Promotion BLOCKED — preconditions unmet.**

- BI: `<BI-XXXXXXXX>`
- Failed precondition: <which one>
- Resolution: <which upstream skill to invoke>
```

## Guardrails

- **Never promote a BI that hasn't been triaged.** `triageOutcome=build` is the contract; promoting a triaging-status BI bypasses governance.
- **Never promote work the operator hasn't approved for build.** Even if `proposedOutcome=build` and triage flipped to build, surface "promoting `<id>` to BS" to the operator first if the BI was filed in this same session (PAR — Propose, Acknowledge, Reassign).
- **Never force-route feature work to BS for central tracking.** Central visibility comes from Workrooms, backlog links, evidence records, and PR health. If the operator asks to work here, or if BS is not the right executor, use the external host-worktree path and record evidence instead.
- **Never claim "BS will handle it" and then ignore the queue.** Promoted BIs need active operator attention at the Ideate gate. If you can't or won't attend, don't promote.

## Worked example (counter-example, 2026-05-24)

This bundle's child BIs (BI-98BDFA75, BI-3C1A6451, BI-AD86EE4E) were originally proposed for promotion to BS. The operator overrode the standing rule because BS was down ("Build studio isn't working right now, we are testing in a separate thread, let's do the development here"). The in-session path proceeded: audit done in-session, semantic-fallback fix done TDD in-session, skill authoring (this BI) done in-session.

**This is now the standard peer-surface rule, not an exception.** The in-session path was correct because:
1. BS was empirically unavailable (runtime down for an unrelated test).
2. The operator explicitly authorized in-session development.
3. The work was bounded enough to land in a single session.

For future work, those conditions are examples, not a three-part exception test. If the task is too large or complex for BS, or the operator asks to continue in Claude Code / Codex / Grok, the right call is to keep working externally while tracking centrally through Workrooms and evidence.

## See also

- Predecessor skill: [`dpf-file-backlog-item`](../dpf-file-backlog-item/SKILL.md)
- BS orchestrator: [`apps/web/lib/build/build-orchestrator.ts`](../../../../apps/web/lib/build/build-orchestrator.ts)
- Delivery-surface doctrine: [`AGENTS.md §12`](../../../../AGENTS.md#12-delivery-surfaces--execution-alignment)
- BS lifecycle status: `project_build_studio_lifecycle_status` (user memory)
- Reset Build for stuck FeatureBuilds: `EP-BUILD-64B599` (see live epic list)
