# Plan — Wire org WWWD into the decision path (BI-230C9EF7)

**BI:** BI-230C9EF7 (open, `medium`, epic **EP-WWMD-MCP**) — "Org DecisionPerspectiveProfile resolution entry-point (select per-org profile by ownerOrganizationId)."
**Governing doctrine:** [`decisions-belong-to-their-scope`](../../founder-kernel/wiki/principles/decisions-belong-to-their-scope.md) (PR #2094) — each decision resolves in its owning scope; cross-scope doctrine is advisory until the owning scope speaks. This plan is the work that turns that boundary from *documented* into *enforced*.
**Status:** Phase 1 **IMPLEMENTED** (2026-06-26, external build) — `evaluateOrgBusinessDecisionGate()` + co-located tests shipped in `apps/web/lib/decision-perspective/org-business-gate.ts`; `persistDecisionInteraction` parameterized (optional `build`, `routeContext`, `phaseFrom/phaseTo`, `outcomePayloadExtra`) so non-build (org/WWWD) decisions record to the same ledger. This activates the dormant org/profession resolution so a coworker business decision is governed by the org's own stance (WWWD) with platform fallback as advisory. It is the keystone the progressive-autonomy trust dial (EP-8AF1C996) reads to measure agreement. **Phase 2** (wire to a coworker business-decision surface) is now also **IMPLEMENTED** — the `evaluate_org_business_decision` MCP tool (grant `work_capsule_read`, capability `view_operations`) lets a coworker route a business decision through the gate and receive a recommendation + ledger record; the org id is resolved per single-org-install. So the gate is now invokable end-to-end. **Phase 3** (consolidate `principle_decide` business questions into this gate) remains.

---

## 1. Problem

A customer organization's WWWD profile is seeded at onboarding but **never consulted by any decision**, so a customer's business decision is, in effect, governed by the founder kernel (WWMD) — the exact non-inherit-boundary violation the platform's own doctrine forbids.

## 2. Current state (grounded)

| Fact | Evidence |
|---|---|
| The org-resolution **primitive is built and fully tested** — `resolveOrgProfileId()` (select active `kind="organization"` profile by `ownerOrganizationId`) and `resolveProfileMaterialForOrg()` (compose with the fallback chain, return `orgProfileSelected`) | `apps/web/lib/decision-perspective/material.ts:333-386`; tests `material.test.ts:108-230` |
| The primitive is **called by zero production surfaces** | grep: only `material.ts` (def), `material.test.ts`, and a "mirror" comment in `resolve-profession-profile.ts:138` |
| The Decision Perspective **Gate is wired only to Build Studio plan-advancement**, and neither call site passes an org/profile — it defaults to the platform WWMD profile | `build-studio-gate.ts:159`; callers `actions/build.ts:516`, `app/api/agent/build/advance-phase/route.ts:125` |
| Build Studio plan-advancement is **platform work** → WWMD is the *correct* authority there; this call site should NOT become org-aware | `build-studio-gate.ts` (question = "Start implementation for a Build Studio plan") |
| Customer coworkers reach decisions two ways today, **neither org-profile-governed**: (a) reasoning over passively-injected WWWD wiki context (`recallWikiContext`), or (b) `principle_decide` — a **separate subsystem** that scores options against founder-kernel *wiki principles*, not `PerspectiveMaterial`/profiles | `actions/agent-coworker.ts` (wiki recall); `wiki/principle-decide.ts` + `decision/option-scoring.ts` (kernel scoring); `tak/decision-routing-block.ts` (prompt-level routing only) |

**The real gap is not "call the function."** The primitive's other half — a **customer-business-decision Gate entry-point that passes `organizationId`** — does not exist. The Gate evaluator (`evaluator.ts:evaluateDecisionPerspective`) and persistence (`persistence.ts`) are ready; only an org-context composition + a calling surface are missing.

## 3. Design decision

| Option | What | Verdict |
|---|---|---|
| **A — org-context Gate entry-point** | Add `evaluateOrgBusinessDecisionGate({ db, organizationId, question, options, domainClass, … })` that composes `resolveProfileMaterialForOrg` → `evaluateDecisionPerspective` → `persistDecisionInteraction`, recording `orgProfileSelected` (WWWD vs WWMD-advisory) in the ledger. Mirrors the proven `evaluateBuildStudioPlanAdvancementGate`. | **Recommended.** Smallest correct use of the built primitive; additive; makes the governing scope auditable; directly realizes `decisions-belong-to-their-scope`. |
| **B — make `principle_decide` profile-aware** | Teach the kernel-principle scorer to select WWWD by caller. | Defer. Conflates two subsystems (kernel-principle scoring vs perspective-material evaluation); this is the broader consolidation, larger blast radius. |
| **C — passive wiki context only** | Keep coworkers reasoning over injected WWWD pages, no gate. | Reject. No authority resolution, no ledger, boundary stays unenforced. |

## 4. Phased plan

**Phase 1 — the entry-point (this BI; low-risk, additive, no behavior change).**
- Add `evaluateOrgBusinessDecisionGate()` in `decision-perspective/` composing the existing primitive + evaluator + persistence.
- Fail-closed on evaluator error (mirror the BS gate's `failClosedEvaluation`).
- An org with no WWWD profile → `orgProfileSelected: false`, falls through to the platform profile **as advisory** (preserves today's behavior, but now *explicit and recorded* rather than silent).
- Persist `orgProfileSelected` + `resolvedProfileChain` on the `DecisionInteraction` so audit shows *which scope governed*.
- Tests: org-with-WWWD selects org profile; org-without falls back with `orgProfileSelected:false`; ledger row records the chain; fail-closed path. (Pattern: `build-studio-gate.test.ts`.)

**Phase 2 — wire it to the first real customer-decision surface.**
- Choose one customer business-decision surface and route it through the Phase-1 gate (candidate surfaces: a coworker business-decision MCP tool, or the `decision-routing-block` "organization's business call" branch made to call the gate instead of only instructing).
- Surface the governing scope in the decision UX ("governed by your organization's WWWD" vs "platform doctrine, advisory").
- This is the step that makes the boundary observably enforced for end users.

**Phase 3 — consolidation (separate, larger; EP-WWMD-MCP).**
- Route coworker `principle_decide` *business* questions through the gate (Option B), unifying the two decision paths. Out of scope for this BI.

## 5. Acceptance criteria

- A customer org with a seeded WWWD profile and applicable material has its business decision resolved against **its own** profile, with a `DecisionInteraction` recording `orgProfileSelected: true` and the org profile at the head of `resolvedProfileChain`.
- A customer org **without** WWWD material gets the platform profile **as advisory**, recorded `orgProfileSelected: false` — never silently presented as the org's own authority.
- Build Studio plan-advancement behavior is **unchanged** (still WWMD).
- New unit tests pass; `packages`/`web` suites and `next build` green.

## 6. Risks & rollout

- **Additive, behavior-preserving.** Phase 1 introduces an unused-by-default entry-point; nothing changes until Phase 2 wires a surface. Safe to land independently.
- **Fail-closed** on evaluation error, matching the BS gate, so a resolver/evaluator fault escalates rather than silently allowing.
- **No schema change** expected — `DecisionInteraction` already carries `resolvedProfileChain`; confirm it can store `orgProfileSelected` (or derive it from the chain head vs platform id) before adding a column.

## 7. Open decisions for the operator

1. **Phase-2 target surface** — which customer business-decision surface to route through the gate first?
2. **BI bookkeeping** — close BI-230C9EF7 as "primitive complete" and track the wiring as a new BI under EP-WWMD-MCP, or keep BI-230C9EF7 as the umbrella through Phase 2? (The spec-cited "BI-E1FB2307" consolidation id is **not** in this install's live backlog.)
3. **Execution path** — implement Phase 1 directly (code→tests→CI→PR, per the Build-Studio-rearchitecture latitude) or promote to Build Studio?
