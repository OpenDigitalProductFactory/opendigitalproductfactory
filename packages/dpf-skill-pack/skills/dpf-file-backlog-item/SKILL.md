---
name: dpf-file-backlog-item
description: "Use when new DPF work needs to enter the backlog — a feature gap, bug, tool, skill or doc gap, automated detection, or user request."

# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: mcp__dpf__create_backlog_item mcp__dpf__list_epics mcp__dpf__link_backlog_item_to_epic mcp__dpf__triage_backlog_item mcp__dpf__size_backlog_item mcp__dpf__list_backlog_items mcp__dpf__query_backlog mcp__dpf__search_specs_and_plans

# DPF coworker fields (Surface B — in-portal seed loader)
category: ops
assignTo: ["build-specialist", "ops-coordinator", "platform-engineer"]
capability: null
taskType: workflow
triggerPattern: "file (a |new )?(backlog item|BI|bug|gap|ticket)|add to backlog|track this|new work item"
userInvocable: true
agentInvocable: true
allowedTools: ["mcp__dpf__create_backlog_item", "mcp__dpf__list_epics", "mcp__dpf__link_backlog_item_to_epic", "mcp__dpf__triage_backlog_item", "mcp__dpf__size_backlog_item", "mcp__dpf__list_backlog_items", "mcp__dpf__query_backlog", "mcp__dpf__search_specs_and_plans"]
composesFrom: ["dpf-verify-substrate-first"]
contextRequirements: ["dpf MCP server reachable"]
riskBand: medium

# Kernel principle enforcement
enforces:
  - kernel/principles/backlog-lives-in-postgresql
  - kernel/principles/check-epic-overlap-before-creating
  - kernel/principles/live-state-over-seed-data
---

# DPF File a Backlog Item

When a piece of work needs to enter the DPF queue — feature gap, bug, tool gap, skill gap, doc gap — **it goes through `mcp__dpf__create_backlog_item`**, not into a floating spec or a TODO comment. The DPF BI lifecycle gate sits in front of the planning step ([`dpf-writing-plans`](../dpf-writing-plans/SKILL.md)): a plan is for a BI, not for floating intent. A build-bound BI and its design are one capture outcome: reuse an adequate canonical design, extend one, or create the proportional design in `docs/superpowers/specs/` before reporting the BI as fully filed. This skill walks the verify → design → file → size → triage → link-epic flow so the BI lands with the right shape, design, and epic on the first try.

## When to use

- Operator describes a feature gap, bug, or process gap that isn't already tracked.
- Substrate-verification (`dpf-verify-substrate-first`) confirms no existing BI covers it.
- A spec or plan session produced child work items that need backlog tracking.
- Auto-detected issue from CI / Hermes loop / scout sweep needs to enter governance.

## When NOT to use

- The work is already tracked — find the existing BI with `mcp__dpf__query_backlog` and link to it instead.
- The work is operator-scope only (read-only research, in-session question answer). Not all work needs a BI.
- You're inside an active Build Studio decomposition — `approve_decomposition` materializes child BIs transactionally; use this skill only when filing or mapping them before that gate.
- Skill / coworker / capability work — those have their own substrate (`SkillDefinition`, `agent_registry.json`); see `add-skill.skill.md` for the Surface B coworker-skill path.

## Read first

| Source | Path | What to extract |
|---|---|---|
| MCP tool contract | [`apps/web/lib/mcp-tools.ts`](../../../../apps/web/lib/mcp-tools.ts) `create_backlog_item` | Required fields, valid `type`/`source`/`status`/`triageOutcome` enums |
| Strongly-typed enums | [AGENTS.md §3](../../../../AGENTS.md) | `Epic.status` and `BacklogItem.status` valid values |
| Open epics | `mcp__dpf__list_epics({ status: "open" })` | Where to link this BI — extending an existing epic beats creating a new one |
| Substrate verification | preceding [`dpf-verify-substrate-first`](../dpf-verify-substrate-first/SKILL.md) output | The verification ledger that justifies new work |
| Canonical designs | `docs/superpowers/specs/` plus `search_specs_and_plans` | The existing design to reuse/extend, or evidence that a proportional new design is required |

## Enforces

- `kernel/principles/backlog-lives-in-postgresql` — file via MCP so the live state stays authoritative; never via a seed-file edit.
- `kernel/principles/check-epic-overlap-before-creating` — query existing epics for overlap; prefer extending over creating.
- `kernel/principles/live-state-over-seed-data` — always query the live backlog before claiming "this isn't tracked."

## Steps

1. **Compose with `dpf-verify-substrate-first` first** if this is the first BI in a thread of work. Its output ledger should show no overlap with existing BIs/epics; if it shows overlap, abandon this skill and link to the existing item instead.

2. **Choose the right `type`.** Enum: `portfolio | product`.
   - `portfolio` = substrate / governance / cross-cutting work (this whole bundle's parent BI).
   - `product` = a discrete feature, defect fix, or capability that ships.

3. **Choose the right `workType` and `source`.** `workType` is what the work is (`bug | feature | chore | doc | tool | skill | refactor`). `source` is how it entered the queue (`user-request | automated-detection`). Keep these axes separate and match AGENTS.md §3 exactly.

4. **Choose the right epic.** Run `mcp__dpf__list_epics({ status: "open" })` and pick the closest semantic fit. If two epics could fit, pick the higher-priority one. Only create a new epic via `mcp__dpf__create_epic` if no existing one is even adjacent — and document the rationale in the BI body.

5. **Set `proposedOutcome` advisory.** Enum: `build | runbook | coworker-task | defer | duplicate | discard`. This is non-binding on triage but it tees the Scrum Master coworker up — pick `build` for code work, `coworker-task` for one-shot procedural work, `defer` if dependent on unblocking work, `duplicate` if you missed the overlap check (and supply `duplicateOfId`).

6. **Set `effortSize` when proposedOutcome=build.** Enum: `small | medium | large | xlarge`. Required for `triageOutcome=build`. Rough mapping: small = under a day, medium = 1-3 days, large = 1-2 weeks, xlarge = larger. `xlarge` requires an explicit decomposition decision before implementation: independently shippable children become live BIs (or map to existing BIs); retaining one BI requires the governed atomic rationale and receipt from `dpf-writing-plans`.

7. **Establish design coverage for every build-bound BI.** Search `docs/superpowers/specs/` and `search_specs_and_plans` by the problem, substrate, epic, and proposed BI title.
   - Reuse an existing design only when its objectives and acceptance contract actually cover this deliverable; link the BI to the exact section.
   - Extend the canonical shared design when the new BI is an independently shippable successor under the same architecture.
   - Otherwise create a proportional canonical design before claiming capture is complete. Even a small defect may use a short design, but it must name the authority/data/runtime boundary, objectives, acceptance criteria, non-goals, migration/compatibility posture, and research where AGENTS.md requires it.
   - If the current surface cannot write source, leave the BI `triaging`, record the missing design as the explicit next handoff, and report **partially captured — design pending**. Never advance it to `build` or present it as ready.

8. **Write the body.** Markdown. Include:
   - Problem statement (1-2 sentences naming the gap).
   - Scope (what's in, what's out).
   - Acceptance criteria (bullet list of observable outcomes).
   - Dependencies (`Blocks:` / `Blocked by:` references to other BI ids if applicable).
   - Link to full context (memo, spec, audit, or PR if available).

9. **Call `mcp__dpf__create_backlog_item`** with the assembled fields. Capture the returned `entityId` (e.g. `BI-AD86EE4E`) for reference in subsequent BIs or in the operator response. Immediately add the generated BI id to the canonical design and keep both changes in the same delivery branch/PR.

   When a spec or plan produced several independent deliverables, repeat the overlap query and filing step for each uncovered deliverable, then pass all new and existing IDs plus dependencies to `record_plan_backlog_coverage`. Do not leave successors as unchecked Markdown.

10. **Optionally call `mcp__dpf__triage_backlog_item`** in the same flow if you're skipping the default `triaging` status — supply `outcome` + `rationale` (+ `effortSize` if outcome=build). `outcome=build` is allowed only after Step 7 established canonical design coverage.

11. **Report back.** Include: BI id, parent epic, canonical design path/section and status, body excerpt, what's blocked-by or blocking, link to MCP audit row. “Filed” without design status is an incomplete receipt.

## Output template

```
**Backlog item filed.**

- Id: `<BI-XXXXXXXX>`
- Epic: `<EP-XXX>` (<epic title>)
- Design: `<docs/superpowers/specs/...md §N>` (<reused|extended|created|pending>)
- Type / workType / source: <portfolio|product> / <work-type-enum> / <user-request|automated-detection>
- ProposedOutcome / size: <outcome> / <size>
- Body summary: <one sentence>
- Dependencies: blocks <ids> | blocked by <ids> | independent
- Audit row: <ToolExecution id from MCP response>
```

If the substrate-verification step in §1 surfaced overlap, do NOT file — instead report:

```
**Skipped filing — existing item covers this.**

- Existing item: `<BI-XXXXXXXX>` (<title>)
- Overlap reasoning: <one sentence>
- Recommended action: <comment on existing item | take ownership | unblock | other>
```

## Guardrails

- **Never invent `BI-` or `EP-` ids.** The MCP tool auto-generates them; supplying `itemId` manually is for the rare backfill case and risks collision.
- **Never bypass the substrate-verification step** in autonomous sessions. The cost of a duplicate BI is a triage round-trip; the cost of preventing duplicates is one MCP call.
- **Never set `status` outside `triaging`** without a paired `triageOutcome` — the MCP tool will reject. Use `triage_backlog_item` for the transition instead.
- **Never edit `packages/db/src/seed.ts` to add a BI.** Seeds are bootstrap; the backlog lives in Postgres (`kernel/principles/live-state-over-seed-data`).
- **Never paraphrase the body** if the BI is part of a tracked bundle — use the verbatim body from the source memo so audit trails align.
- **Never leave a build-bound BI designless.** A generated BI id without canonical design coverage remains triage intake, not build-ready work. The design and BI cross-link in the same branch/PR; the later plan receives independent approval and coverage receipts through `dpf-writing-plans`.

## Worked example (2026-05-24)

Filing this bundle's parent BI from [docs/superpowers/drafts/2026-05-24-dpf-skill-pack-formalization-bi-bundle.md](../../../../docs/superpowers/drafts/2026-05-24-dpf-skill-pack-formalization-bi-bundle.md):

1. `dpf-verify-substrate-first` confirmed no overlap with `EP-SKILL-001` (different surface scope) and named `EP-REDUCTION-GEAR-ARCH` as the right parent.
2. Type: `portfolio` (substrate consolidation).
3. WorkType / source: `skill` / `user-request` (the requested work adds missing DPF-specific procedural skills).
4. Epic: `EP-REDUCTION-GEAR-ARCH` (priority 2, substrate-consolidation framing).
5. ProposedOutcome: `build`. EffortSize: `large` (7 child BIs, ~2 weeks elapsed).
6. Body: verbatim from memo §2 (problem statement + scope + acceptance criteria + child enumeration + cross-refs + operator-ratified context).
7. `mcp__dpf__create_backlog_item(...)` returned `BI-90793048`. Then 7 children filed individually with `Blocked by:` references and the same epic.

The whole flow took one MCP call per BI, with the dependency relationships captured in the bodies rather than as separate links (MCP doesn't yet expose blocked-by as a structured relation — that's a known gap; see [add to backlog: BI hierarchy as structured relation](#) — *file me*).

## See also

- Tool: `mcp__dpf__create_backlog_item` ([apps/web/lib/mcp-tools.ts](../../../../apps/web/lib/mcp-tools.ts))
- Predecessor skill: [`dpf-verify-substrate-first`](../dpf-verify-substrate-first/SKILL.md)
- Successor skill: [`dpf-promote-to-build-studio`](../dpf-promote-to-build-studio/SKILL.md) (for BIs ready to enter the BS pipeline)
- AGENTS.md §6 (Backlog & Planning)
