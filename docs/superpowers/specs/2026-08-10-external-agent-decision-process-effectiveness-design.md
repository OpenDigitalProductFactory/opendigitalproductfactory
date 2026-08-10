# External-agent decision process effectiveness (Grok + peers)

**Date:** 2026-08-10  
**Epic:** EP-PROCESS-SPINE  
**BIs:** BI-FD7CBA06 (gateKey), BI-D5ACBAE2 (process/skills), BI-6A686EBB (adoption metrics)  
**Kernel consult:** DI-24A1F966C697 — recommend `enforce-call-plus-observability` (high confidence)

## 1. Operator question

Is AGENTS.md + `principle_decide` + the exposed process actually working for Grok and other external clients? Low visible decision volume suggested it was not.

## 2. Evidence (live install, 2026-08-10)

| Fact | Measurement |
|---|---|
| Ledger substrate | **Works.** `principle_decide` returns `ledger.recorded=true` and writes `DecisionInteraction` (probe DI-24A1F966C697). |
| Volume | **1,269** DecisionInteraction rows total; **704** last 7d; **1,244** last 30d. |
| ToolExecution | `principle_decide`: **66** / 7d, **319** / 30d. |
| By domain | profession architecture-tradeoff 420; backlog-triage 340; kernel-consult 277; build-studio plan-readiness 211. |
| Unresolved escalate | **382** open escalations (hub can look "stuck"). |
| kernel-consult `gateKey` | **All null** before BI-FD7CBA06 (domainClass set, gate not named). |
| callingSurface (30d) | **118** distinct free-form values; **650** rows with no surface. |
| External kernel-consult | Almost entirely **Codex**-labeled; **Grok nearly silent** until this investigation. |
| Wrong store | `wiki_query` `pageKind=decision` (DEC-*) is a **different** corpus and was empty — easy false "no decisions". |
| Skill drift | `dpf-record-decision-outcome` pointed at build notes, not DecisionInteraction. |
| Session process | Investigation started on root `main` without worktree/capsule — process skipped under activation pressure (same class of defect that produced `.agents/rules/pre-work-checklist.md`). |

## 3. Diagnosis (not a broken ledger)

The platform **does** record decisions when tools are called. The operator signal of "lack of decisions" is mostly:

1. **Adoption gap** — Grok (and often Claude) threads do not call `principle_decide` on multi-option work; Codex does more often.
2. **Attribution gap** — free-form / missing `callingSurface`; null `gateKey` on kernel-consult.
3. **Discoverability gap** — looking at wiki DEC pages or open-escalate noise instead of `/coworker-decisions/decisions`.
4. **Skill/docs gap** — record-outcome skill taught a parallel home; AGENTS.md did not state auto-persist or surface conventions.

## 4. Plan (execute in BIs)

| BI | Work | Status |
|---|---|---|
| BI-FD7CBA06 | Set `gateKey: "kernel-consult"`; WWMD audit map; tests | This PR |
| BI-D5ACBAE2 | Fix skills + AGENTS callingSurface + ledger.recorded guidance | This PR (skills/AGENTS) |
| BI-6A686EBB | Surface adoption metrics + silent-surface warnings on decision log | Follow-on |
| Existing | BI-368A2656 process-conformance ledger; BI-69A76F0A principle_decide timeouts; BI-9C7F2190 evidence receipts | Compose, do not duplicate |

## 5. Cross-surface contract (normative for agents)

1. Multi-option **platform** decision → `dpf-decision-via-kernel` / `principle_decide` with features + normalized `callingSurface`.
2. Confirm `ledger.recorded` and report DI id.
3. `dpf-record-decision-outcome` only attaches follow-on evidence; it does not invent a second ledger.
4. Code work still requires BI → claim → worktree branch → implement (AGENTS §3–4).
5. Progressive MCP: `load_tools` then host-catalog invoke — never skip governance because the host list is stale.

## 6. Verification

- Unit: kernel-consult-ledger gateKey; decision-audit tier map includes `kernel-consult`.
- Live (post-upgrade): `principle_decide` with `callingSurface: "grok-desktop"` → DI row with `gateKey=kernel-consult` visible on `/coworker-decisions/decisions`.

## Design grounding

- Existing specs/plans reviewed:
  - docs/superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md
  - docs/architecture/delivery-surfaces-runbook.md
  - docs/superpowers/plans/2026-07-06-decision-governance-audit-log.md
- Current code substrate reviewed:
  - apps/web/lib/decision/kernel-consult-ledger.ts
  - apps/web/lib/wiki/decision-audit.ts
  - apps/web/lib/decision-perspective/types.ts
  - packages/dpf-skill-pack/skills/dpf-decision-via-kernel/SKILL.md
- Source of truth:
  - DecisionInteraction remains the decision ledger; skills must not re-home outcomes into build notes.
- Decision:
  - Set gateKey=kernel-consult; normalize callingSurface; fix record-decision skill; keep one process across Grok/Claude/Codex.

Seed-Fit-Decision: global-default
