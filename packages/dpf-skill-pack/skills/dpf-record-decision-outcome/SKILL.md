---
name: dpf-record-decision-outcome
description: "Use after a DPF WWMD/kernel decision is made and the outcome needs recording."
disable-model-invocation: false
user-invocable: true
allowed-tools: mcp__dpf__principle_decide mcp__dpf__record_decision_outcome mcp__dpf__record_capsule_evidence mcp__dpf__wiki_query
category: governance
assignTo: ["*"]
capability: null
taskType: evidence
triggerPattern: "record decision|save decision outcome|decision evidence|capture recommendation|record WWMD|ledger recorded"
userInvocable: true
agentInvocable: true
allowedTools: ["mcp__dpf__principle_decide", "mcp__dpf__record_decision_outcome", "mcp__dpf__record_capsule_evidence", "mcp__dpf__wiki_query"]
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
- When the operator (or agent) **overrides** the kernel recommendation. The DI row exists, but the override is invisible until `record_decision_outcome` names the option you took.
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

3. **Report what you actually did — `record_decision_outcome`.** This is the step that
   makes the decision measurable. Call it AFTER acting, with the `interactionId` and the
   option you went with:

   - went with the kernel's pick → pass that option id.
   - **chose differently → pass the option you took.** That records an override, and an
     override is the most valuable row in this corpus: a labelled case where the scoring
     and the actor disagreed, which is the only thing that can tune the scoring. State
     in `rationale` what the kernel missed. Do not soften it and do not skip the call
     because you diverged.
   - the decision was dropped, superseded or overtaken → pass `chosenOptionId: null`.
     Unresolved is a recorded state. **Not calling at all is not** — absence means
     "nobody reported", and it is never counted as agreement.
   - `resolvedBy` is `agent` unless a person actually chose. An agent agreeing with the
     kernel and a human agreeing with it are different measurements and are never pooled.

   Refusals are informative, not errors to retry: `no-recommendation` (the kernel
   abstained — nothing to agree with), `already-resolved` (record an amendment as its own
   decision; do not overwrite a correction), `option-not-offered` (that option was never
   scored).

4. **Attach to the Workroom when one exists.** Call `record_capsule_evidence` with a short,
   operator-readable summary: decision question, chosen option, `interactionId`, next action.
   This is the human-readable pointer. It does **not** substitute for step 3 — prose in an
   evidence blob cannot be selected, counted, or learned from.

5. **Escalation.** When the outcome was `escalate`/`defer`, also raise it through open
   decision reviews. That is a different thing from the outcome record and does not replace it.

6. **Do not** write a second decision record to notes-only tools for the same consult.

## Output template

```
**Decision recorded (ledger).**

- Question: <one sentence>
- Recommendation: <optionId> (confidence <high|low>)
- Operator disposition: <accepted | overridden: <option> | escalated>
- Outcome recorded: <followed | overridden | unresolved> (record_decision_outcome)
- DecisionInteraction: <DI-…>
- Hub: /coworker-decisions/decisions/<DI-…>
- Capsule evidence: <id or n/a>
- Next action: <one sentence>
```

## Guardrails

- **Single source of truth** is `DecisionInteraction`. Workroom evidence **points at** the DI; it does not replace it.
- **The disposition belongs in a column, not in prose.** Before `record_decision_outcome`
  existed this skill asked for the chosen option in a free-text evidence summary, and the
  result was that of 1,080 recorded decisions exactly one carried a known outcome. A
  sentence in an evidence blob is not a measurement.
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
