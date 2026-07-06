# Decision Governance Audit Log — surface the ledger, instrument the gate

**Date:** 2026-07-06
**Epic:** EP-0AF96937 (Decision Governance surface redesign) — follow-on to Phases 1–4 (#2573/#2575, commits 298658db6/bebeb339c)
**Companion:** BI-44526F3E (WWWD corpus activation — owns routing business calls through `evaluate_org_business_decision`; out of scope here)

## 1. Problem

The Decision Governance hub (`/wiki`) presents three decision tiers — WWMD (platform doctrine), WWWD (the business), WSID (role craft) — as a HITL-equivalent gate, but the operator cannot see the decisions the gate actually made, so there is no way to validate the feature is in play or effective. Verified on the live install (2026-07-06): the `DecisionInteraction` ledger, its `EscalationCapture`/`DeferralCapture` companions, and `DecisionShadowLedger` all hold **zero rows ever**, because:

1. **WWMD** — `principle_decide` (the tool consulted constantly by external agents and skills) computes a recommendation and returns it with **no persistence at all** (`apps/web/lib/mcp-tools.ts`, `case "principle_decide"`). Only a `console.info` trace line exists.
2. **WWWD** — `evaluate_org_business_decision` does write the ledger, but is never invoked: the coworker decision-routing prompt predates it (BI-44526F3E G3) and this install has no org profile (G1).
3. **WSID** — profession profiles exist (24 seeded) but no decision path attributes rows to them yet.

The hub's "open reviews" chips already read the ledger — they are honest but vacuous while nothing writes.

## 2. Approach

Two legs, one PR:

**Leg A — make the biggest writer write.** Persist every `principle_decide` call to `DecisionInteraction` via a new fail-open recorder (`apps/web/lib/decision/kernel-consult-ledger.ts`), attributed to the governing profile the handler already resolves (`resolveDecisionCallerContext` — WWMD platform vs WWWD organization). Outcome mapping encodes the HITL semantics: confident conflict-free recommendation → `recommend`; commandment conflict or low-margin call → `escalate` (feeds the open-review queues); no applicable principles → `defer` (coverage gap). A new `kernel-consult` domain class keeps these rows a distinct cluster in `/wiki/review` findings. The write is fail-open (a ledger outage never blocks the decision) but always observable: the tool response carries `ledger: { recorded, interactionId | reason }`, and a skip (e.g. unprovisioned WWWD profile) is named, not silent.

**Leg B — surface the log.** New `/wiki/decisions` audit surface (report-kit composition):
- Per-tier StatCards: 30d count, unresolved count, all-time, with an explicit **"never used"** warning state — a silent tier is itself the finding.
- Filterable decision timeline (tier pills → `?tier=wwmd|wwwd|wsid`), showing when/tier/question/outcome/recommendation/risk/conflict/where.
- Drill-in `/wiki/decisions/[interactionId]`: options weighed (recommended highlighted), rationale, top principle contributors, flags, human-resolution state (escalation capture / deferral gap / awaiting review).
- Hub cards each gain a usage chip (`N decisions · 30d` / warning `no decisions recorded`) and a **Decision log** action.

Tier attribution is by profile kind (`platform`→WWMD, `organization`→WWWD, `profession`→WSID), so rows written by the Build Studio gate, the org business gate, work-pattern review, and the new kernel-consult recorder all land in the same audit view without special-casing their writers.

## 3. Explicitly out of scope

- Routing coworker business decisions through `evaluate_org_business_decision` (BI-44526F3E Phase A3) — once that lands, its rows appear here automatically.
- WSID-attributed writes from profession surfaces (no current writer; the tier shows honestly silent until one exists).
- Escalation-resolution workflows (exist at `/platform/ai/founder-review` and `/wiki/review`; the log links to them).

## 4. Verification

- Unit: `kernel-consult-ledger.test.ts` (outcome mapping, profile attribution, observable skip, fail-open), `decision-audit.test.ts` (tier mapping, awaiting-human semantics), extended `decision-governance-hub.test.ts` (usage chips, log links).
- Runtime (canonical install, post self-upgrade): call `principle_decide` via MCP → row visible at `/wiki/decisions` with WWMD attribution; hub chip flips from "no decisions recorded" to a live count.
