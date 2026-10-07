---
status: active
---

# Plan-to-Build Gate: the Delegated Policy Decides, and a Person Only on a Named Basis

- Date: 2026-10-07
- Backlog: BI-7FFFBEE3
- Decisions:
  - founder decision DI-3D3BEF5109AF (2026-10-06): the gate `build-studio-plan-advancement` is WWWD, the owner's delegated policy decides, and it escalates only when that policy cannot settle;
  - operator decisions 2026-10-07 (this spec).
- Programme: `docs/superpowers/plans/2026-10-07-autonomous-delivery-program.md`, gate rule
- Related: `docs/superpowers/specs/2026-10-07-autonomy-policy-sources-design.md` (BI-E30C0F4F)

## Operator direction (2026-10-07)

- "All work should have a method of autonomous decision that can suffice. For human delegation for approval the gate criteria should be clear and traceable to either regulatory or policy based criteria."
- Delegated policy values: the AI arbitrator decides **up to high risk** when the recorded doctrine gives **≥ 0.70 confidence**. Critical risk, or weaker grounding, escalates to the accountable person, and the escalation names this policy and the threshold the decision missed.

## Problem (measured on the live install, 2026-10-07)

The delegated policy can never settle a plan-advancement decision today:

1. **A hard-coded rule pre-empts the policy.** `apps/web/lib/decision-perspective/evaluator.ts` escalates every `high` or `critical` decision ("Escalate this high-risk decision to the accountable resolver even though profile confidence is …") before it reads the profile's `autonomyPolicy`. A second hard-coded rule escalates whenever `confidence < 0.9 && riskTier !== "low"`.
2. **Every profile forbids arbitration.** `mark-dpf-platform`, `dpf-organizational-principles` and the org perspective profile all read `allowArbitration: false, maxRiskForArbitration: "low", minimumConfidenceForArbitration: 0.9`. These values are seeded by `packages/db/src/seed-decision-perspective.ts` and the install's risk envelope (`apps/web/lib/onboarding/apply-risk-envelope-to-profile.ts`).
3. **The risk tier comes from a keyword.** `plan-to-build-transition.ts` derives `riskTier` from `planRec.deliverableSensitivity`, a prose-keyword scan. BI-F521E322 ("a word is not evidence") made build sensitivity read the plan's files; this gate did not follow.
4. **Shadow verdicts fill the owner's inbox.** The gate runs in shadow (`DPF_BUILD_AUTONOMOUS_PLAYBOOK_MODE=shadow`): builds advance regardless. Yet every escalate verdict is a `DecisionInteraction` with `outcomeType: "escalate"` and no `humanOutcome`, which `apps/web/lib/attention/sources/ai-decision.ts` lists as "Make this business decision? … build … stays blocked". On 2026-10-07 the owner inbox held 25+ of these, none of them true.
5. **The gate still runs as WWMD.** `evaluateBuildStudioPlanAdvancementGate` does not pass `organizationId`, contrary to DI-3D3BEF5109AF.

## Research and Benchmarking

- **Delegation-of-authority matrices in ERP approval workflows** (SAP Flexible Workflow, Oracle approval hierarchies). An approval routes up only when the item exceeds the delegate's recorded limit, and the routing names the limit exceeded. **Adopted:** the delegated policy is the limit (`maxRiskForArbitration`, `minimumConfidenceForArbitration`), and every escalation names it. **Rejected:** a fixed escalation by category regardless of the delegate's limit, which is what the hard-coded high-risk rule does.
- **OPA Gatekeeper `dryrun`/`warn` enforcement actions and Kubernetes admission audit.** A new policy runs in audit mode: violations are recorded in an audit report, not raised as blocking events, until it is switched to `deny`. **Adopted:** shadow verdicts go to the comparison report (AC-GATE-WWWD-SHADOW), never to a person's queue. **Rejected:** surfacing audit-mode findings as actionable approvals.
- **NIST AI RMF (GOVERN 1.4, MANAGE 2.4), on human oversight.** Oversight roles and the conditions for engaging them are defined and documented, not left to an implicit threshold. **Adopted:** human engagement is triggered only by a recorded policy condition, and the condition is cited.

## Design

### 1. The delegated policy decides; hard-coded thresholds go

In `evaluator.ts`, after the existing principle-conflict and content-aware stance rules:

- Remove `riskTier === "high" | "critical" → escalate`.
- Replace `confidence < 0.9 && riskTier !== "low" → escalate` with the policy's own thresholds:
  - **Arbitrate** when `allowArbitration`, `riskWithin(riskTier, maxRiskForArbitration)` and `confidence ≥ minimumConfidenceForArbitration` (the existing rule, now reachable).
  - **Escalate** otherwise. The rationale names the profile, the policy field and value, and the value the decision had. For example: "Escalate: risk critical exceeds policy mark-dpf-platform maxRiskForArbitration=high", or "Escalate: confidence 0.62 is below policy minimumConfidenceForArbitration=0.70".
  - The existing confidence-floor rules (`minimumConfidenceForRecommendation`, the recommendation band) stay. They already name a policy value or the material's ceiling.
- A matched regulatory policy requiring human control (BI-E30C0F4F) escalates and names its regulation.

### 2. Policy values

The operator decided values for **platform-development (WWMD)** decisions. The `balanced` risk envelope is the default autonomy policy for every organization on every install, and its comment records that no posture lets an agent arbitrate a high-risk call. The operator has not decided to change that for customer businesses, so the envelopes stay as they are.

- **Platform profile (WWMD).** `seed-decision-perspective.ts` sets `mark-dpf-platform` to `allowArbitration: true`, `maxRiskForArbitration: "high"`, `minimumConfidenceForArbitration: 0.7`. These are seed-owned keys, so every self-upgrade refreshes them; operator-owned keys survive, as today.
- **A new policy field, `maxRiskForRecommendation`.** It replaces the hard-coded "high and above escalates" and defaults to `medium`. Every profile not changed above (all three risk envelopes, profession profiles, the defaults) behaves exactly as before, and its escalations now name the field.
- **This install's organization profile (WWWD)** gets the operator's values as the owner's own delegated policy in slice C, with the WWWD shadow evaluation. That slice adds the governed way to set it: operator-owned keys that a risk-envelope re-apply does not overwrite. It does not change the envelope.

### 3. WWWD, shadow first (DI-3D3BEF5109AF)

- `evaluateBuildStudioPlanAdvancementGate` evaluates twice while in shadow: as today (WWMD), and with the build's `organizationId` (WWWD, the delegated policy). Both verdicts are recorded and compared in a report.
- Switching WWWD to blocking is a reviewed operator decision. It ships in a later PR that also removes the PR-5b divergence row.

### 4. Risk tier from the plan's files

`plan-to-build-transition.ts` derives `riskTier` from `assessDeliverySensitivity({ planPaths: buildPlanPaths(build.buildPlan) })` (BI-F521E322) instead of `planRec.deliverableSensitivity`.

### 5. Shadow verdicts are not inbox items

A gate evaluation that cannot block, because the mode is shadow or because it is the comparison verdict, records `outcomePayload.mode = "shadow"`. `loadAiDecisionItems` excludes those rows, the same way it already excludes retracted ones. The verdict stays in the comparison report and the decision audit.

## Implementation status

- **Slice A (this branch):** §1 and §4 are done, plus the platform half of §2. The evaluator no longer escalates on a risk tier; the delegated policy bounds risk (`maxRiskForArbitration`, or the new `maxRiskForRecommendation`, default `medium`). Every escalation names its profile, field and value. The platform profile seed allows arbitration up to high risk at ≥ 0.70. The customer risk envelopes are unchanged. The plan-to-build risk tier follows the plan's files.
- **Slice B:** §5, keeping shadow verdicts out of the inbox.
- **Slice C:** §3, WWWD beside WWMD in shadow with a comparison report, and setting this install's organization delegated policy through operator-owned keys (§2).

## Non-Goals

- Switching WWWD to blocking (a later, reviewed decision).
- Changing other gates (`org-business` callers, ship gate); they inherit §1 and §2 through the shared evaluator and profiles.
- Back-resolving existing inbox items; they are re-evaluated when their builds next advance. A one-time sweep marks the existing shadow-origin escalations as shadow.

## Verification

- Evaluator tests:
  - high risk at confidence ≥ 0.70 arbitrates under the new policy;
  - critical risk escalates and names `maxRiskForArbitration`;
  - confidence below 0.70 escalates and names `minimumConfidenceForArbitration`;
  - a regulatory human-control row escalates and names its regulation;
  - no rationale says "even though profile confidence".
- Seed test: platform profile values, versioned and non-clobbering.
- Envelope test: the three risk envelopes are unchanged; a high-risk decision under each escalates and names `maxRiskForRecommendation`.
- Gate test: in shadow, both WWMD and WWWD verdicts are recorded and the comparison row is written; behaviour is unchanged (AC-NO-BUILD-STUDIO-BREAK).
- Attention test: shadow-mode escalations are not listed; blocking escalations still are.
- Transition test: the risk tier follows the plan's files, not the prose.
- Live: after upgrade, new plan-advancement decisions on this install arbitrate up to high risk, and the owner inbox gains no shadow items.
