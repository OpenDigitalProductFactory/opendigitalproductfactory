---
name: dpf-my-surface-backlog
description: "Use to see, open, file, and track backlog items for your own surface and occupation only."

# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: true
user-invocable: true
allowed-tools: mcp__dpf__list_my_backlog mcp__dpf__get_backlog_item mcp__dpf__create_backlog_item mcp__dpf__get_my_coworker_profile

# DPF coworker fields (Surface B — in-portal seed loader)
category: ops
assignTo: ["*"]
capability: null
taskType: workflow
triggerPattern: "my backlog|(BIs?|backlog|items?|work) for my (surface|area|portfolio|occupation)|what('?s| is) (in|on) my (backlog|queue|plate)|file (a )?BI for my (area|surface)|my capability (gaps?|needs?) as backlog"
userInvocable: true
agentInvocable: false
allowedTools: ["mcp__dpf__list_my_backlog", "mcp__dpf__get_backlog_item", "mcp__dpf__create_backlog_item", "mcp__dpf__get_my_coworker_profile"]
composesFrom: ["dpf-file-backlog-item"]
contextRequirements: ["dpf MCP server reachable"]
riskBand: medium

# Kernel principle enforcement
enforces:
  - kernel/principles/backlog-lives-in-postgresql
  - kernel/principles/live-state-over-seed-data
---

# DPF — My Surface Backlog

Every AI coworker is responsible, together with its human counterpart, for its own evolution. The backlog is where that happens: the coworker sees the work outstanding against its surface and occupation, files the gaps it hits, and watches them get built. This skill is the tight, identity-scoped lens for that loop — three tools, no ids to pass, safe to run on a local model.

Scope is resolved from **who you are** (your MCP identity), never from an argument. `list_my_backlog` has no scope parameter, so you cannot see another portfolio's items — that is deliberate: it keeps sensitive portfolios isolated and the tool honest on a small model.

## When to use

- You want to know what backlog work stands against your area — "what's on my plate", "the BIs for my surface".
- You hit a gap while working (a missing tool, a missing skill, a feature your surface needs) and want to file it as a BI for your own capability growth.
- You want to open a specific BI to read its full scope, spec/plan links, and status.
- Your human counterpart asks what's outstanding or in-progress for your area.

## When NOT to use

- You need the whole platform backlog, not your slice — use `query_backlog` / `list_backlog_items` (governance surfaces), not this lens.
- You are recording a durable *capability need* for human review rather than filing a build item — use `submit_coworker_capability_need` (it creates review records, then files BIs on your behalf).
- You are triaging, sizing, or promoting someone else's BI — that is the ops/build flow, not this self-scoped lens.

## Enforces

- `kernel/principles/backlog-lives-in-postgresql` — read and file through MCP so live state stays authoritative.
- `kernel/principles/live-state-over-seed-data` — always read your live slice; never infer it from seed files.

## Steps

### 1. See your backlog — `list_my_backlog`
Call it with no arguments to get your whole slice, or narrow with `status` / `workType`:

```
list_my_backlog()                          # everything in your area
list_my_backlog(status="open")             # only open items
list_my_backlog(workType="tool")           # your own tool/skill gaps — capability-evolution work
```

The result carries:
- `summary` — an open / in-progress / done roll-up for your slice.
- `scope` — how you were scoped: `portfolioId` (your surface), `professionKey` (your occupation), and `occupationArmApplied` (whether capability-linked items contributed; `false` means your slice fell back to area + owned).
- `items` — each with `itemId`, `title`, `status`, `workType`, `priority`, `epicId`.

Your slice is the union of: **your surface** (your portfolio / taxonomy area), **your occupation** (BIs trace-linked to capabilities in your value stream), and **anything assigned to or claimed by you** — so nothing you are accountable for is ever hidden, even outside your area.

### 2. Open a BI — `get_backlog_item`
Pass an `itemId` from the list to read the full record: body, scope, epic, active build, spec/plan files, recent activity.

```
get_backlog_item(itemId="BI-XXXXXXXX")
```

### 3. File a BI for your area — `create_backlog_item`
When you find a gap, file it. `create_backlog_item` **stamps your identity automatically**, so anything you file immediately shows up in your `list_my_backlog` (via the owned arm) — you do not pass an agentId. Give it a clear `title`, the `workType` (`tool` / `skill` / `feature` / `bug` / …), and a `body` with the problem, scope, and acceptance criteria.

```
create_backlog_item(
  title="...", type="product", workType="tool",
  body="## Problem ... ## Scope ... ## Acceptance ...",
  proposedOutcome="build")
```

For the full filing discipline (substrate-verify → shape → epic), compose with [`dpf-file-backlog-item`](../dpf-file-backlog-item/SKILL.md). Portfolio-area attribution and triage happen in the ops flow; your job is to file the gap well and track it.

### 4. Track it
Re-run `list_my_backlog` (or `list_my_backlog(status="in-progress")`) to watch what you filed move through build. This is the flywheel: exercise reveals a gap → you file it → it ships → your capability grows.

## Output template

```
**My surface backlog** — <portfolioId or "route-scoped">, occupation <professionKey or "unmapped">
- Roll-up: <open> open · <in-progress> in-progress · <done> done
- Top open items:
  - `<BI-…>` <title> (<workType>, p<priority>)
- Filed this session: `<BI-…>` <title>
```

## Guardrails

- **Never try to widen the scope.** There is no portfolio/agent argument on `list_my_backlog`; do not reach for `query_backlog` to see another coworker's slice unless you are doing sanctioned cross-area governance.
- **Sensitive items stay in-slice.** Do not copy BI bodies from your slice into surfaces the human counterpart cannot already see.
- **File, don't self-approve.** You file and track; triage, sizing, and build promotion are governed steps owned by the ops/build flow.
- **One gap, one BI.** Check your own list before filing so you do not duplicate an item you already raised.

## See also

- Tool: `list_my_backlog` (identity-scoped read lens) · `get_backlog_item` · `create_backlog_item`
- Composes from: [`dpf-file-backlog-item`](../dpf-file-backlog-item/SKILL.md) — the full filing discipline.
- Adjacent: `submit_coworker_capability_need` — durable capability gaps for human review (files BIs for you).
