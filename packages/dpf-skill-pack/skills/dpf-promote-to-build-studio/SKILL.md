---
name: dpf-promote-to-build-studio
description: "Use when a DPF backlog item is triaged 'build' and ready to enter the Build Studio pipeline. Encodes the 'Build Studio for ALL development' standing rule: file BI → promote → approve Ideate → let BS run. Claude never writes feature code directly when BS is available. Has no upstream superpowers analog because BS is DPF's unique recursive build substrate."

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
---

# DPF Promote to Build Studio

DPF has a standing rule: **Build Studio handles all development.** File BI → promote → approve Ideate → let BS run. Claude (the contributor agent) never writes feature code directly when BS is available — that's the recursive substrate point. This skill walks the promotion handoff so BS picks up the work in the shape it expects and the operator's only job is to ratify the Ideate phase output.

## When to use

- A backlog item is triaged with `outcome=build` and `effortSize` set.
- Build Studio runtime is online (the recursive build path is available).
- The BI has a usable body (problem + scope + acceptance criteria); BS uses this as the brief.
- Operator has signaled "let's build this" or you've reached the post-triage transition in an autonomous flow.

## When NOT to use

- BI is in `triaging` status — promote requires `outcome=build`. Triage first (`mcp__dpf__triage_backlog_item`).
- Build Studio runtime is down — do the work in-session per the explicit fallback path (operator must authorize this exception to the standing rule; this is what the 2026-05-24 thread did when BS was down).
- The work is operator-scope only (research, audit, decision) — those don't enter BS.
- The work is a coworker-skill addition (use `add-skill` coworker skill instead) or a kernel-page edit (use `draft-kernel-edit-pr`).
- The BI body is incomplete or vague — BS will Ideate it into a worse spec than you'd write yourself. Author the body fully via `dpf-file-backlog-item` first.

## Read first

| Source | Path | What to extract |
|---|---|---|
| BI state | `mcp__dpf__get_backlog_item({ itemId })` | Current status, triageOutcome, effortSize, body — promotion preconditions |
| BS runtime health | `mcp__dpf__list_build_activity_since` or the `/build` page | Whether the BS runtime is online and has capacity |
| BS pipeline phases | [`apps/web/lib/integrate/build-orchestrator.ts`](../../../../apps/web/lib/integrate/build-orchestrator.ts) | The lifecycle gates this BI will traverse (Ideate → Plan → Build → Verify → Ship) |
| Standing rule context | [`feedback_build_studio_for_all_development`](../../../../#) memory | Why this skill is the default path, not the exception |

## Enforces

- `kernel/principles/architecture-over-shortcuts` — the recursive build substrate IS the architectural choice; bypassing it for "speed" creates the debt the principle names.
- `kernel/principles/governance-approves-evidence-not-provenance` — BS's phase gates approve evidence quality, regardless of who produced it; the promotion is the contract.

## Steps

1. **Verify preconditions.** Call `mcp__dpf__get_backlog_item({ itemId })`. Check:
   - `status` is `open` (post-triage) — not `triaging`, not `done`, not `deferred`.
   - `triageOutcome` is `build`.
   - `effortSize` is set (small/medium/large/xlarge).
   - `body` is non-empty and includes the acceptance criteria.
   If any check fails, do NOT promote — return the user to the upstream skill (`dpf-file-backlog-item` for missing body; `mcp__dpf__triage_backlog_item` for missing triage).

2. **Check BS runtime health.** Call `mcp__dpf__list_build_activity_since({ since: <ISO-2h-ago> })` to confirm the orchestrator is processing. If activity is dead for hours, the runtime may be down — surface to operator before promoting (a promoted BI sitting in a dead queue is worse than an unpromoted one).

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
- **Never write the feature code yourself when BS is up** unless the operator explicitly authorizes the in-session path. This is the `feedback_build_studio_for_all_development` standing rule.
- **Never claim "BS will handle it" and then ignore the queue.** Promoted BIs need active operator attention at the Ideate gate. If you can't or won't attend, don't promote.

## Worked example (counter-example, 2026-05-24)

This bundle's child BIs (BI-98BDFA75, BI-3C1A6451, BI-AD86EE4E) were originally proposed for promotion to BS. The operator overrode the standing rule because BS was down ("Build studio isn't working right now, we are testing in a separate thread, let's do the development here"). The in-session path proceeded: audit done in-session, semantic-fallback fix done TDD in-session, skill authoring (this BI) done in-session.

**The standing rule is the default, not the law.** The override happened because:
1. BS was empirically unavailable (runtime down for an unrelated test).
2. The operator explicitly authorized in-session development.
3. The work was bounded enough to land in a single session.

Without all three conditions, the right call would have been to promote to BS and wait. This skill's guardrail ("never write the feature code yourself when BS is up") explicitly carves out the operator-authorized exception.

## See also

- Predecessor skill: [`dpf-file-backlog-item`](../dpf-file-backlog-item/SKILL.md)
- BS orchestrator: [`apps/web/lib/integrate/build-orchestrator.ts`](../../../../apps/web/lib/integrate/build-orchestrator.ts)
- Standing rule context: `feedback_build_studio_for_all_development` (user memory)
- BS lifecycle status: `project_build_studio_lifecycle_status` (user memory)
- Reset Build for stuck FeatureBuilds: `EP-BUILD-64B599` (see live epic list)
