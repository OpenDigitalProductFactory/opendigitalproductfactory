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

> **Amended 2026-07-20 (BI-1BE30A9A).** Profile-kind attribution is correct only while no gate falls back across kinds. It is not: `evaluateProfessionDecisionGate` resolves to `MARK_DPF_PLATFORM_PROFILE` whenever the craft corpus has no material for a decision class, so a WSID decision would persist with `profileId=mark-dpf-platform` and audit as **WWMD** — leaving the WSID tier reading "never used" however often the gate ran, and inviting exactly the wrong conclusion (§3 below assumed a silent tier means no writer; it can equally mean a misattributed one).
>
> Attribution is therefore by **the gate that produced the row**, recorded on `DecisionInteraction.gateKey` (`build-studio`→WWMD, `org-business`→WWWD, `profession`→WSID) with a companion `gateFallbackUsed` flag preserving the "was this the coworker's own doctrine or a fallback?" signal that profile kind used to carry implicitly. Profile kind remains the fallback for rows written before the column existed; that backfill is exact, because the profession gate had never run when they were written. See `tierForRow` in `apps/web/lib/wiki/decision-audit.ts`.

## 3. Explicitly out of scope

- Routing coworker business decisions through `evaluate_org_business_decision` (BI-44526F3E Phase A3) — once that lands, its rows appear here automatically.
- ~~WSID-attributed writes from profession surfaces (no current writer; the tier shows honestly silent until one exists).~~ **Superseded 2026-07-20:** a writer does exist — `evaluate_profession_decision` — but it was unreachable because the pack required a grant the EA coworker lacks (BI-88B77204), and would have been misattributed if reached (BI-1BE30A9A). The tier was silent for two compounding reasons, neither of them "no writer". Routing the architecture advisory through the gate (BI-D6CFE63A) is the first real WSID writer.
- Escalation-resolution workflows (exist at `/platform/ai/founder-review` and `/wiki/review`; the log links to them).

## 4. Verification

- Unit: `kernel-consult-ledger.test.ts` (outcome mapping, profile attribution, observable skip, fail-open), `decision-audit.test.ts` (tier mapping, awaiting-human semantics), extended `decision-governance-hub.test.ts` (usage chips, log links).
- Runtime (canonical install, post self-upgrade): call `principle_decide` via MCP → row visible at `/wiki/decisions` with WWMD attribution; hub chip flips from "no decisions recorded" to a live count.

## 5. Migration addendum (post-#2647 live verification)

Live verification caught a DB/TS enum drift: the `DecisionInteraction_domainClass_check` /
`PerspectiveMaterial_domainClass_check` constraints (migration 20260517233000) froze the
domain-class set at the original three values, so every `kernel-consult` ledger write failed
its CHECK — observably (`ledger.recorded=false`, fail-open) but the audit trail stayed empty.
Migration `20260706110000_align_decision_domainclass_check` widens both constraints to the
full registry (`professional-practice`, `kernel-consult` added). Widening is data-safe.
