# Kernel-decided time-off (GONE analog) — implementation plan

| Field | Value |
| ----- | ----- |
| Umbrella BI | `BI-4D030159` — Kernel-decided time-off (GONE analog) |
| Epic | `EP-F7BD23BB` — HCM Autonomous Delight (Paycom-parity level-5 overlay) |
| Date | 2026-08-07 |
| Research anchor | [Paycom HCM competitive analysis §9.2](../research/2026-08-06-paycom-hcm-competitive-analysis.md) |
| Parallel effort | Greenhouse ATS absorption (`EP-ECOSYSTEM-ABSORPTION-ARCH`) — see §3 coordination |
| Delivery decision | **Decomposed** — 3 deliverables (D1 governed leave actions · D2 propose-only coworker · D3 boundary decision) |

**For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

---

## 1. What we are building, and the constraint that shapes it

Paycom's **GONE** auto-approves/denies time-off via a policy engine (staffing needs, consecutive days, seniority, hours worked). DPF already holds the request record (`LeaveRequest`/`LeaveBalance`/`LeavePolicy`, scorecard capability 6 at maturity level 3) **and** the decision kernel (`principle_decide`). The kernel is the native, *auditable* substrate for a leave decision — DPF's edge over GONE's black-box policy is that every verdict carries an explainable, replayable contribution ledger.

**The load-bearing constraint (discovered during substrate mapping).** `apps/web/lib/workforce/staffing/coworker/authority.ts:25-31` already classifies **`decide_leave` as `HUMAN_ONLY` / non-delegable** — "an optimizer or AI model may never, by itself … decide leave, approve an exception" (citing spec §2.2 / §11 / §12.3). BI-4D030159 as literally titled ("auto-approve/deny leave") **crosses that carve-out.** We do not cross a commandment-like boundary silently.

**Resolution — the DPF-native shape.** Ship a **propose-only leave-decisioning coworker + escalate-by-exception**: the AI does the reasoning, produces an approve/deny **recommendation** with a kernel rationale, and either routes it to the accountable human approver or escalates by exception. The human confirms. This is exactly the research doc's thesis — *"the AI does the work; the human confirms"* — and it is the more-ethical form of GONE (it also sidesteps Paycom's worst complaint, "forcing decisions/work onto people"). **Full** auto-decide (removing the human — true Paycom-GONE) is a governance decision (`decide_leave` boundary amendment), sequenced as D3 and gated on a WWMD/kernel + founder ruling. It is **not** built until that boundary is formally amended.

This decomposes the umbrella BI into three independently shippable deliverables:

- **D1 — Governed leave actions** (prerequisite; closes a known audit-log gap). Independently shippable, no boundary issue.
- **D2 — Propose-only leave-decisioning coworker** (the core delight; this is `BI-4D030159`'s own scope).
- **D3 — Employment-AI boundary decision** (governance; whether/how to permit bounded full auto-decide). Sequenced last; may be declined.

---

## 2. Substrate the plan builds on (verified, file-anchored)

All paths under `apps/web/` unless noted. Verified by code-graph + read during planning.

**Leave records & workflow**
- Models `LeavePolicy` / `LeaveBalance` / `LeaveRequest` — `packages/db/prisma/schema.prisma:8911-8969`. `LeaveRequest.status` defaults `"pending"` → `approved|rejected|cancelled`; has `approverEmployeeId?`, `approvedAt?`, `rejectionReason?`. **No rationale/decision-ledger column exists** — D2 adds one.
- Read layer `lib/workforce/leave-data.ts` — `getLeaveRequests({employeeProfileId?,status?,managerId?})`, `getLeaveBalances(...)`, **`getTeamLeaveCalendar(departmentId?,start?,end?)`** (the "who else is already off" input).
- Write layer `lib/actions/leave.ts` — `submitLeaveRequest` (13-64), `approveLeaveRequest` (66-115), `rejectLeaveRequest` (117-143). Approve/reject call `authorizeApprovalDecision(...)` **but write no `AuthorizationDecisionLog`** (the D1 gap).
- UI `components/employee/LeavePanel.tsx` — request form + manager `pendingApprovals` with approve/reject buttons.
- Approval spine `lib/workforce/approval-authority.ts` (`authorizeApprovalDecision(userId, subjectEmployeeProfileId, noun)`) + `approval-routing.ts` (`resolveAccountableApprover(rows, employeeProfileId)`, `describeUnresolvedRouting(...)`). **The AI acts *on behalf of* the resolved human approver (`onBehalfOf` semantics) — it does not replace this spine.**

**Decision kernel (in-app)**
- Pure engine `lib/decision/option-scoring.ts` — `decide(options, principles, config?) → DecisionResult`; `buildOptionScores(...)` yields the `PrincipleContribution[]` ledger; guardrails `insufficientSignal` / `commandmentConflict` / low-margin.
- In-process handler `lib/mcp/packs/principle-decide-pack.ts` — `principleDecide(params, context?)` (retrieval + embed + `decide()` + persist). **Call `principle_decide` as a tool; do not re-implement retrieval.** `callingPopulation: "in_platform_coworker"`.
- Dimension registry `lib/decision/dimension-catalog.ts` (`DIMENSION_KEYS`, `validateOptionFeatures`). Relevant axes already exist: `capacity_utilization`, `business_disruption`, `governance_compliance`, `reversibility`, `legibility_of_consequence`.
- Rationale/ledger `lib/decision/kernel-consult-ledger.ts` — `recordKernelConsultInteraction({...}) → {interactionId}` (append-only sealed `DecisionInteraction`); **`mapConsultOutcome(result)` → `recommend|escalate|defer`** is the ready-made escalate-by-exception classifier. **Link `interactionId` to the `LeaveRequest`.**

**Coverage inputs**
- `lib/mcp/packs/staffing-pack.ts` — `getStaffingCoverage({organizationId})` → per-demand `{required, assigned, covered, status}` + `uncoveredCount` (the "are we short-staffed if approved?" input; tool `get_staffing_coverage`, `requiredCapability: view_employee`).
- `lib/workforce/staffing/view/coordinator-view.ts` — `ChangeRow.kind` already models `"leave_approved"` as a coverage-affecting change; `maskEventForCoordinator(...)` enforces the busy-mask privacy contract.

**AI-coworker registration + the reuse precedent**
- Proposal record **`AgentActionProposal`** — `schema.prisma:6218-6244`: `{proposalId, threadId, agentId, actionType, parameters Json, status "proposed"→decidedAt/decidedById/executedAt}`. **The canonical "AI proposes an action over a record, a human decides" table — reuse with `actionType:"leave.decide"`; do not invent a leave-proposal model.**
- Payload precedent `lib/workforce/staffing/coworker/prepare-proposal.ts` — `prepareStaffingProposal(...)` (pure; `autoPublish:false`). Mirror this shape for `leave.decide`.
- Authority boundary `lib/workforce/staffing/coworker/authority.ts` — `authorizeStaffingAction(ctx)`, `requiresHumanApproval(action)`; **`StaffingAction` already includes `decide_leave` as human-only. Extend this module for the propose path; the auto-act path stays blocked until D3.**
- Registration `lib/mcp/packs/coworker-establish-pack.ts` (`establish_coworker`) + `lib/mcp/pack-registry.ts` + grant mirror `lib/tak/agent-grants.ts` (`TOOL_TO_GRANTS`, drift-test enforced). Use the `dpf-establish-coworker` paved road.

**Governed audit write path**
- `lib/actions/workforce.ts` — `withGovernedWorkforceAction({actionKey, riskBand, objectRef?, run})` (107-156) writes `AuthorizationDecisionLog` on deny **and** after the run. Backed by `lib/govern/governance-data.ts:85-125` `createAuthorizationDecisionLog({actorType, actorRef, actionKey, objectRef?, decision, rationale})`. A kernel-decided path writes `actorType:"agent"`, `agentContextRef` = coworker agentId, `actionKey:"leave.decide"`, `objectRef` = requestId, `rationale` = `{interactionId, topContributors}`.

---

## 3. Coordination with the parallel Greenhouse absorption

The Greenhouse effort (`EP-ECOSYSTEM-ABSORPTION-ARCH`: `BI-E5561DC9` bridge→absorb→replace, `BI-9CC44DC7` recruiting pipeline surface, `BI-02F1F944` hire→`EmployeeProfile` landing, `BI-27456471` **replace** — Harvest extraction + dual-run + cutover + Greenhouse retirement) is **recruiting/ATS**. The active parallel thread is the **replace** phase. **There is no functional overlap** with leave decisioning — hiring vs. absence are disjoint domains. Coordination is purely **shared-infrastructure hygiene + convention consistency**.

**Verified shared touchpoints (2026-08-07, branch state) and the merge-safe rule for each:**

| Shared file / substrate | Current state | This plan (D2) adds | Merge-safe rule |
| --- | --- | --- | --- |
| `apps/web/lib/mcp/pack-registry.ts` | `recruitingPipelinePack` import @68, array entry @150 | `leaveDecisionPack` import + array entry | **Append at the END of the import block and the END of the array** (not adjacent to recruiting's lines) so git auto-merges both threads' additions. |
| `apps/web/lib/tak/agent-grants.ts` `TOOL_TO_GRANTS` | `get_recruiting_pipeline` @719; **unlisted tools are denied by default** (@836-841) | `propose_leave_decision` (or similar) entry | Add a distinct, commented entry; **reuse existing grant keys** (`consumer_read`, `registry_read`, + an existing write grant) rather than minting a new key (a new key touches the shared grant catalog — higher coordination cost). |
| `AgentActionProposal` (`schema.prisma:6218`) | shared proposal table; recruiting/staffing use it | `actionType:"leave.decide"` | **Distinct actionType namespace** (`leave.*` vs recruiting's). New string value, **not** a new table/migration. |
| `EmployeeProfile` | `BI-02F1F944` lands hires into it | leave decisions read it | **Read-only from D2** — no schema contention. |
| Coworker/pack **convention** | `recruiting-pipeline-pack.ts` is the shipped template: `ToolPack = { packId, definitions, handlers, grants }`, tools carry `requiredCapability`/`sideEffect`/`buildPhases`/`annotations`, inline `grants` **must equal** the `agent-grants.ts` mirror | `leave-decision-pack.ts` mirrors this shape exactly | **Follow the template, don't fork it.** One consistent "AI coworker over a record" surface across both absorptions. |
| UI-gate avoidance | recruiting ships an **MCP tool over a shared read-model and defers the UI page** to dodge the route/ux-fit gauntlet | D2 renders on the existing `LeavePanel`; **no new ratified route** | Avoids `page-purpose` + `ux-fit` sweep. |

**Reuse precedent split:** take the **pack STRUCTURE** from `recruiting-pipeline-pack.ts` (it is the shipped template) and the **decision/proposal pattern** from the AI *staffing* coworker (`AgentActionProposal` + `prepareStaffingProposal` + `authority.ts` + kernel-consult-ledger). Recruiting's pack is a read-only *lens*; D2 is a *decision-maker* (WWWD via `evaluate_org_business_decision`, escalating by exception) — so its handler writes a proposal, but its shape and registration follow the recruiting template.

**Coordination protocol (both threads):** because `gh pr list` cannot see a peer session's in-flight work, before editing `pack-registry.ts` / `agent-grants.ts` / `schema.prisma`, grep the file's recent git history and append in a clearly-commented block rather than editing near the other thread's lines. The two threads merge to `main` independently; auto-merge holds as long as additions are non-adjacent.

---

## 4. Phased deliverables

### D1 — Governed leave actions *(prerequisite · size small · independently shippable · ✅ IMPLEMENTED)*
**Deliverable.** `approveLeaveRequest`/`rejectLeaveRequest` write an `AuthorizationDecisionLog` — `allow` on a completed decision, `deny` when approval authority refuses.
**Design correction (found during build).** `withGovernedWorkforceAction` (workforce.ts) enforces the platform-capability model (`manage_user_lifecycle`/`manage_users`); leave uses a **different** authority model — org-chart manager authority via `authorizeApprovalDecision`. So D1 does **not** reuse that wrapper; it calls `createAuthorizationDecisionLog` (`@/lib/governance-data`) **directly around the existing `authorizeApprovalDecision` check** — deny-log on authority refusal (before any state change), allow-log after the state change. This preserves leave's correct authority model while adding the audit trail.
**Touched files.** `lib/actions/leave.ts` (audit calls in both actions; import `createAuthorizationDecisionLog` + `type Prisma`). New `lib/actions/leave.test.ts` (mocked-prisma pattern mirroring `workforce.test.ts`). No schema change.
**Verification (functional).** ✅ `dpf-tdd` red→green run in the compile-ready worktree: 4 tests (allow + deny × approve/reject) failed 0-calls against the unmodified code, pass after the change. Live-install ledger check remains for pre-merge verification.
**Why first.** No boundary issue; closes a real audit gap; D2's agent-actor audit path (`actorType:"agent"`) reuses the same `createAuthorizationDecisionLog` writer.

### D2 — Propose-only leave-decisioning coworker *(core · this is `BI-4D030159` · independently shippable · 🚧 in progress)*
**Deliverable.** A coworker + MCP surface that, on an eligible `LeaveRequest`, (a) reads `getLeaveRequests` + `getLeaveBalances` + `getTeamLeaveCalendar` + `get_staffing_coverage`, (b) builds `DecisionOption`s (approve / deny) with features on the existing dimension axes, (c) calls `principle_decide` (`callingPopulation:"in_platform_coworker"`), (d) records the rationale via `recordKernelConsultInteraction` and classifies with `mapConsultOutcome`, (e) applies the **hard safety guards** then writes an `AgentActionProposal(actionType:"leave.decide", status:"proposed")` linking the `interactionId`, (f) escalates by exception (`escalate|defer`, or coverage-breach/negative-balance/blackout/consecutive-limit) to the `resolveAccountableApprover` human, and (g) surfaces the recommendation + sealed rationale on `LeavePanel` and the request history. The actual state change stays on the governed `approveLeaveRequest`/`rejectLeaveRequest` path (D1).

**Build increments (D2 is itself multi-part):**
- **D2.1 — safety core ✅ DONE.** `lib/workforce/leave/leave-decision-policy.ts` — pure `evaluateLeaveGuards()` (the hard rails: overdraw balance / coverage breach / consecutive-day limit / blackout → force escalate) + `resolveLeaveDecision({guards, kernelOutcome})` (guard always wins toward escalation; a clean kernel recommend/deny passes through; ambiguous kernel outcome escalates by exception). Kernel-independent by construction — the safety property holds whatever the kernel scores. Verified: 10 vitest cases red→green.
- **D2.2 — decision surface + orchestration** (next). **⚠ DESIGN CORRECTION (kernel-validated 2026-08-07):** the decision surface is **`evaluate_org_business_decision` (WWWD — the organization's own staffing/leave doctrine), NOT `principle_decide` (WWMD — the platform founder kernel).** A leave approval is a *business* decision, not a platform-development one. Validation: running the leave scenarios through `principle_decide`/`in_platform_coworker` returned "approve" but the ledger was dominated by irrelevant **platform software-delivery commandments** (Human-in-the-Loop at Phase Boundaries, All Changes Land via PR Against Main, DCO Sign-Off, Build Gate) — tightening coverage barely moved the composite (6.27→5.50). The same call through `evaluate_org_business_decision` (`domainClass:"risk-assessment"`, `riskTier` per request) returned `recommend/approve`, confidence 0.825, `orgProfileSelected:true`, and an `interactionId` (`DI-10D9889499CA`) for the audit ledger — grounded in org stance and holding the act back from the AI. This matches the skill's own WWMD-vs-WWWD boundary. **Orchestration:** call `evaluate_org_business_decision(question, [approve,deny], "risk-assessment", riskTier, optionFeatures)` → map `outcomeType`/`recommendedOptionId` to `LeaveDecisionOutcome` (recommend+approve→`recommend-approve`, recommend+deny→`recommend-deny`, `escalate`/low-confidence/no-stance→`escalate`) → feed D2.1's `resolveLeaveDecision(guards, outcome)`. The returned `interactionId` is the audited rationale linked to the `LeaveRequest` (D2.3). **Dependency:** the org WWWD corpus should carry a staffing/leave stance; when it is silent the surface escalates by exception (the safe default), which is correct behaviour, not a bug. D2.1's guard module is surface-agnostic and needs no change (a `LeaveDecisionOutcome` alias was added for accurate naming). **Progress:** the pure surface adapter `lib/workforce/leave/leave-decision-surface.ts` — `mapOrgDecisionToLeaveOutcome()` mapping the WWWD response (`outcomeType` recommend|arbitrate|escalate|defer + `recommendedOptionId` + `allowed`) into `LeaveDecisionOutcome`, conservative (only a genuine recommend/arbitrate of a known approve|deny with `allowed` survives; everything else escalates) — is built + unit-tested. **The decision core is now built + tested** in `lib/workforce/leave/leave-decision-coworker.ts`: `buildLeaveScoredOptions()` (the approve/deny feature model on real dimension axes — `governance_compliance`/`business_disruption`/`capacity_utilization`/`reversibility`) and `decideLeaveRequest(inputs, {db, gate})` which threads guards (pre-filter — a fired rail escalates without consulting the org) → the **injected** WWWD gate (`evaluateOrgBusinessDecisionGate`, `domainClass:"risk-assessment"`) → surface adapter → `resolveLeaveDecision`, returning `{action, interactionId, orgProfileSelected, operatorMessage, guardReasons}`. Propose-only — never mutates state. The gate is injected so the whole core is unit-tested with **no DB and no MCP** (25 leave tests green). **Remaining D2.2 = the thin I/O wrapper only:** fetch leave-data + `get_staffing_coverage`, call `decideLeaveRequest` with the real `evaluateOrgBusinessDecisionGate`, and hand off to D2.4 (write the `AgentActionProposal`).
- **D2.3 — `decisionInteractionId` migration** (Prisma-7 gauntlet: migrate from `packages/db/`, migration-safety attestation for the nullable column, Data-Impact manifest kind `model`, Docs-Impact trailer).
- **D2.4 — proposal record**: write `AgentActionProposal(actionType:"leave.decide")` linking the `interactionId` (reuse `prepareStaffingProposal` shape; new enum value, not a new table); extend `staffing/coworker/authority.ts` for the *propose* action only.
- **D2.5 — MCP pack**: `lib/mcp/packs/leave-decision-pack.ts` + `pack-registry.ts` entry + `agent-grants.ts` `TOOL_TO_GRANTS` mirror (same commit — drift-test enforced).
- **D2.6 — surface + coworker**: `components/employee/LeavePanel.tsx` renders the recommendation + rationale; coworker defined via `establish_coworker`; golden-journey cert.
**Touched files (remaining).** `lib/workforce/leave/decide-proposal.ts`; `lib/mcp/packs/leave-decision-pack.ts` + `pack-registry.ts` + `agent-grants.ts`; `lib/workforce/staffing/coworker/authority.ts`; migration adding `LeaveRequest.decisionInteractionId String?`; `components/employee/LeavePanel.tsx`.
**Migration note.** Adding `decisionInteractionId` follows the Prisma-7 schema/migration gauntlet (migrate from `packages/db/`, migration-safety attestation for the nullable column, Data-Impact manifest kind `model`, Docs-Impact trailer) — see the Prisma-7 gate memo.
**Verification (functional).** `dpf-tdd`: (1) a request that is safe → `recommend:approve` proposal with a linked `interactionId`; (2) a request that would breach coverage or overdraw balance → `escalate`, no auto-approval; (3) low kernel confidence / commandment flag → `escalate` to the resolved approver; (4) the proposal never mutates `LeaveRequest.status`. Then a golden-journey certification for the recommend path and the escalate path on the live install.
**Boundary guard.** D2 must **not** call `approveLeaveRequest`/`rejectLeaveRequest` itself — it only proposes. A test asserts the coworker holds no grant that mutates leave state. This keeps D2 inside the `decide_leave` HUMAN_ONLY boundary.

### D3 — Employment-AI boundary decision *(governance · size medium · sequenced last · may be declined)*
**Deliverable.** A recorded WWMD/kernel decision + founder ratification on whether/how to permit **bounded** full auto-decide (e.g. auto-approve only when coverage safe + balance sufficient + no policy conflict + high confidence; deny/ambiguous always escalate). If approved: amend `authority.ts` to make `decide_leave` conditionally delegable behind an org-level `TimeOffDecisionPolicy` with explicit bounds, add the policy config surface, and enable D2's auto-act path (writing `actorType:"agent"` `AuthorizationDecisionLog`). If declined: record the rationale; D2 remains the ceiling.
**Process.** `dpf-decision-via-kernel` (`principle_decide` over keep-human-only / bounded-auto-approve / full-auto) → capture ledger → founder ratification → `dpf-record-decision-outcome`. **No source change before the decision is recorded.**
**Verification.** The recorded decision + (if approved) tests that auto-approve fires only inside the bounds and every auto-act writes an agent-actor audit row; deny/ambiguous still escalate.

---

## 5. Backlog coverage

**Decision: decomposed.** Umbrella `BI-4D030159`. Coverage receipt `cmsifvgr3000t01tkbq1t8w7f` (`record_plan_backlog_coverage`, 2026-08-07). Deliverable → BI mapping:

| Deliverable | BI | Epic | Independently shippable |
| --- | --- | --- | --- |
| D1 — Governed leave actions | `BI-04529D29` | EP-WORKFORCE-OPS | yes |
| D2 — Propose-only leave-decisioning coworker | `BI-4D030159` (umbrella/core) | EP-F7BD23BB | yes |
| D3 — Employment-AI boundary decision | `BI-1BF87B1C` | EP-WORKFORCE-OPS | yes (decision-gated) |

Dependencies: **D1 → D2** (audited path reuses the governed wrapper); **D2 → D3** (D3 amends the boundary D2 respects). Revalidate with `check_plan_backlog_coverage(itemId=BI-4D030159, planPath=this, receiptId=cmsifvgr3000t01tkbq1t8w7f)` when resuming.

---

## 6. Risks & rollback

- **Crossing the `decide_leave` boundary by accident.** The single biggest risk. Mitigation: D2 is propose-only and holds no leave-mutating grant (asserted by test); the auto-act path physically does not exist until D3. Rollback: none needed — D2 cannot change leave state.
- **Grant-mirror drift.** Adding `leave-decision-pack` without updating `TOOL_TO_GRANTS` fails the drift test. Mitigation: update both in the same commit (§3).
- **Coverage input privacy.** Coverage/calendar inputs must use the busy-mask (`maskEventForCoordinator`) — the coworker reasons over *availability*, never private leave reasons/titles. Test asserts no private field reaches the kernel option features.
- **Kernel over-trust.** A confident-but-wrong recommendation could bias a human approver. Mitigation: the rationale (top contributors) renders alongside so the human sees *why*; low-margin always escalates rather than recommends.
- **Peer-session overlap on `lib/actions/leave.ts`.** Another session may be hardening leave. Mitigation: overlap-check the file's recent history before D1 (peers' in-flight work is invisible to `gh pr list`).
- **Migration blast radius.** `decisionInteractionId` is an additive nullable column (data-safe); rollback is a down-migration dropping the column — no data loss.

---

## 7. Sequencing

**D1 → D2 → (decision) → D3.** D1 first (small, safe, closes the audit gap, no boundary issue). D2 next (the delight; propose-only, ships within the existing boundary). D3 is a *decision before a build* — run `dpf-decision-via-kernel` + founder ratification before any auto-decide code exists. Lead the epic with this BI because leave is already at maturity 3 and the kernel exists, so D1+D2 are the cheapest path to a live level-5 coworker.
