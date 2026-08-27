---
name: dpf-record-decision-outcome
description: "Use after a DPF WWMD/kernel decision is made and the outcome needs recording."
disable-model-invocation: false
user-invocable: true
allowed-tools: mcp__dpf__principle_decide mcp__dpf__record_capsule_evidence mcp__dpf__wiki_query
category: governance
assignTo: ["*"]
capability: null
taskType: evidence
triggerPattern: "record decision|save decision outcome|decision evidence|capture recommendation|record WWMD|ledger recorded"
userInvocable: true
agentInvocable: true
allowedTools: ["mcp__dpf__principle_decide", "mcp__dpf__record_capsule_evidence", "mcp__dpf__wiki_query"]
composesFrom: ["dpf-decision-via-kernel"]
contextRequirements: ["DPF MCP tools reachable; decision result available"]
riskBand: medium
enforces:
  - kernel/principles/evidence-before-diagnosis
  - kernel/principles/single-source-of-truth
---

# DPF Record Decision Outcome

Close the loop after a WWMD / kernel decision so the operator can **see** it on the Decision Governance log and so follow-on work carries the DI id.

## What is already recorded (do not re-home)

**`principle_decide` already persists** every successful consult to `DecisionInteraction` via the kernel-consult ledger (`apps/web/lib/decision/kernel-consult-ledger.ts`). The tool response carries:

```
data.ledger = { recorded: true, interactionId: "DI-…", profileId: "…" }
# or { recorded: false, reason: "…" } on fail-open skip
```

The operator-visible audit surface is **`/coworker-decisions/decisions`** (and drill-in `/coworker-decisions/decisions/[interactionId]`), **not** wiki `pageKind=decision` DEC-* pages and **not** a parallel build-note store.

> **Anti-pattern (retired).** Do not treat `save_build_notes` / free-form notes as the decision ledger. That was the pre-ledger habit and makes the hub look empty while agents believe they "recorded" something.

## When to use

- After `dpf-decision-via-kernel` / `principle_decide` returns a recommendation.
- When the operator (or agent) **overrides** the kernel recommendation — the DI row exists; you still need to say so in workroom evidence.
- When handing off across surfaces (Grok → Claude → Build Studio) and the next thread must know which DI governed the choice.

## When NOT to use

- Before options are weighed — call `dpf-decision-via-kernel` first.
- To invent a second audit home. One ledger: `DecisionInteraction`.

## Steps

1. **Confirm the ledger write.** From the `principle_decide` response, read `data.ledger`.
   - `recorded: true` → keep `interactionId` (DI-*). Report it to the operator.
   - `recorded: false` → surface `reason` (e.g. profile not provisioned). The decision still returned, but the hub will not show it — that is a process defect; file or escalate.

2. **Report the canonical link.** Operator-facing:
   - Question + recommended option + confidence
   - `interactionId` (DI-*)
   - Hub path: `/coworker-decisions/decisions/<interactionId>`
   - `callingSurface` you passed (must be a **normalized** surface id — see `dpf-decision-via-kernel`)

3. **Attach to the Workroom when one exists.** Call `record_capsule_evidence` with a short, operator-readable summary:
   - decision question
   - chosen option (and whether it matched the kernel recommendation)
   - `interactionId`
   - next action

4. **Human ratification / override.**
   - High confidence + operator agrees → proceed; workroom evidence is enough.
   - Low confidence / commandment conflict / operator override → state the override and rationale in workroom evidence (and escalate via open decision reviews when the outcome is `escalate`/`defer`).

5. **Do not** write a second decision record to notes-only tools for the same consult.

## Output template

```
**Decision recorded (ledger).**

- Question: <one sentence>
- Recommendation: <optionId> (confidence <high|low>)
- Operator disposition: <accepted | overridden: <option> | escalated>
- DecisionInteraction: <DI-…>
- Hub: /coworker-decisions/decisions/<DI-…>
- Capsule evidence: <id or n/a>
- Next action: <one sentence>
```

## Guardrails

- **Single source of truth** is `DecisionInteraction`. Workroom evidence **points at** the DI; it does not replace it.
- Never claim "no decisions are recorded" without checking `/coworker-decisions/decisions` or the DI id from `ledger`.
- Never invent DI ids. Only use ids returned by MCP.
- If MCP progressive loading hides a tool, `load_tools` then retry — do not skip the ledger path.

## Worked example

After WWMD selects "enforce-call-plus-observability" for external-agent process gaps:

1. `principle_decide` returns `ledger: { recorded: true, interactionId: "DI-24A1F966C697" }`.
2. Report that DI and the hub path to the operator.
3. `record_capsule_evidence` on the active Workroom with the DI id and next action (file BIs / implement gateKey).

## See also

- Predecessor: [`dpf-decision-via-kernel`](../dpf-decision-via-kernel/SKILL.md)
- Writer: `apps/web/lib/decision/kernel-consult-ledger.ts`
- Audit: `apps/web/lib/wiki/decision-audit.ts`, route `/coworker-decisions/decisions`
- Process BIs: BI-D5ACBAE2 (external-agent process), BI-FD7CBA06 (gateKey attribution)
