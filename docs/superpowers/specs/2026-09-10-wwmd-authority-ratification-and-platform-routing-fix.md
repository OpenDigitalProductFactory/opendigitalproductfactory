---
title: "Exact-bound WWMD authority: route platform consults to the platform profile and let a human ratify the policy once"
status: active
backlog: BI-9C384562
epic: EP-31815F97
date: 2026-09-10
---

# Exact-bound WWMD authority: route platform consults to the platform profile and let a human ratify the policy once

_Status: implemented on branch `fix/wwmd-exact-bound-authority-ratification` · BI-9C384562 · EP-31815F97 · amends `2026-09-08-wwmd-exact-bound-platform-receipt-authority-design.md`_

## Defect, reproduced on a named ref

Founder question, 2026-09-10: "Why do I have to approve them? Don't you have WWMD?"

On `main` @ `c4ad51898e3d`, four reviewer writers for BI-19CEC4B4 each consulted WWMD through `policy-action-judgment.ts` and got recommend / proceed / confidence 0.99 / autonomy-eligible / sealed, and each still raised a `CoworkerActionEnvelope` (cmturl4g90hc601tc746ieuzh, cmturl4ga0hc701tcaq1d1s47, cmturldgr0hcx01tcabwv68lj, cmturlnia0hdh01tcsskjhh7f) with "WWMD did not produce an exact, high-confidence, autonomy-eligible authorization". Two causes, confirmed by reading the rows and the code:

1. **Wrong profile.** The consult rows carry `profileVersionId = dpf-organizational-principles-v1`. `policy-action-judgment.ts` sends `callingPopulation: "in_platform_coworker"` and no `decisionDomain`; `caller-context.ts:90-92` then applies the legacy heuristic that maps an in-platform coworker to the organization WWWD profile. A "should WWMD authorize this platform action" question was answered by the WWWD chain, the scope violation `decisions-belong-to-their-scope` forbids, and the same routing that placed 48 kernel consults on the org profile in the 17-day ledger.
2. **Unsigned policy.** `DecisionPerspectiveProfileVersion.promotedByPrincipalId` is NULL for `mark-dpf-platform-v1` and `dpf-organizational-principles-v1`. `resolve-policy-action-authority.ts:213-214` skips any candidate whose version has no promoter, and `policy-authority-projector.ts` requires the promoter to be the human root of the delegation. That rule is deliberate (autonomy is rooted in a policy a person ratified once), but the seed creates the version unsigned and no surface let a human sign it. The platform behaved as designed against a kernel nobody had ratified.

Failing-then-passing proof: `policy-action-judgment.test.ts` ("builds a server-owned exact WWMD question") asserts `decisionDomain: "platform-development"` on the request params; `resolve-policy-action-authority.test.ts` asserts the live shape (sealed, high-confidence yes, unratified version) falls to the human and the same row with a promoter projects to `approved`; `decision-perspective-ratify.test.ts` pins the ratification act.

Causes ruled out by running them: the option id (`recommendedOptionId` is `proceed` in the payload), signal quality (`signalUsable`, `autonomyEligible` true, `featureCoverageWeak`, `sensitivityUnstable` false), sealing (`sealedAt` and `chainEntryHash` set), the legacy allowlist (not involved), and the negative-review class (BI-E78DC21D; these were clean passes).

## Objectives

**OBJ-1:** A platform-development authority consult is answered by the founder kernel (WWMD) profile, never the organization's WWWD chain.

**OBJ-2:** A human can ratify a scope-owning policy version once, in the product, and that ratification is what roots autonomous exact-bound approvals; the platform never signs for the human.

## Ordered deliverables

1. `principle_decide` accepts an optional `decisionDomain` (`org-business` | `platform-development`) and passes it to `resolveDecisionCallerContext`; a call carrying a policy projection is forced to `platform-development`.
2. `policy-action-judgment.ts` declares `decisionDomain: "platform-development"` on the consult it builds.
3. `actions/decision-perspective-ratify.ts`: `ratifyPolicyVersion({ profileId })` requires `manage_capabilities`, resolves the signed-in human's principal, and sets `promotedByPrincipalId` on the current version of a platform or organization profile only when it is still NULL (conditional write; a prior ratifier is never overwritten; profession profiles are refused).
4. `/coworker-decisions/perspectives`: platform and organization rows show "Ratified" or a one-time "Ratify this policy" button.
5. Docs: decision-perspective user guide (ratification), this design.

## Acceptance criteria

| AC-ID | Objectives | Statement |
|---|---|---|
| AC-1 | OBJ-1 | The judgment request carries `decisionDomain: "platform-development"` and the resulting ledger row's `profileVersionId` is the platform profile's current version. |
| AC-2 | OBJ-2 | With the version unratified, the live consult shape falls to the human with "Human decision required"; with a promoter set, the same row projects to `approved` (test). |
| AC-3 | OBJ-2 | Ratification records the signed-in human's own principal, refuses profession profiles, returns `alreadyRatified` without writing when a promoter exists, and reports a lost race instead of double-signing. |
| AC-4 | OBJ-2 | After deploy, ratifying `mark-dpf-platform` on the DEV install and re-dispatching a reviewer route for BI-19CEC4B4 produces an `AuthorizationDecisionLog` row with decision `allow`, reasonCode `authorized`, and no envelope (live acceptance, not proven in this PR). |

## Research and benchmarking

The ratification act follows the shape the platform already uses for a human root of trust: Kubernetes' bootstrap of an admin credential that then delegates via RBAC, and HashiCorp Vault's root token that is used once to establish policies and then revoked. Both make the first human act explicit and singular rather than implied by installation. DPF adopts "one explicit ratification, then delegated autonomy"; it rejects the seed writing the founder as promoter because that has the platform sign for the person, which the 09-08 design's provenance check exists to prevent (DI-31EFD3A387B6, margin 6.6).
