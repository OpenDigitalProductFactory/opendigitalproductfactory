# Kernel-decided time-off (GONE analog; WWWD business gate) — implementation plan

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

Paycom's **GONE** auto-approves/denies time-off via a policy engine (staffing needs, consecutive days, seniority, hours worked). DPF already holds the request record (`LeaveRequest`/`LeaveBalance`/`LeavePolicy`, scorecard capability 6 at maturity level 3) **and** the decision-perspective substrate. The organization's WWWD business-decision gate is the native, *auditable* decision surface for leave — DPF's edge over GONE's black-box policy is that every recommendation carries an explainable, replayable interaction record.

**The load-bearing constraint (discovered during substrate mapping).** `apps/web/lib/workforce/staffing/coworker/authority.ts:25-31` already classifies **`decide_leave` as `HUMAN_ONLY` / non-delegable** — "an optimizer or AI model may never, by itself … decide leave, approve an exception" (citing spec §2.2 / §11 / §12.3). BI-4D030159 as literally titled ("auto-approve/deny leave") **crosses that carve-out.** We do not cross a commandment-like boundary silently.

**Resolution — the DPF-native shape.** Ship a **propose-only leave-decisioning coworker + escalate-by-exception**: the AI gathers the facts, consults the organization's WWWD stance, produces an approve/deny **recommendation** with its governed rationale, and routes it to the accountable human approver or escalates by exception. The human confirms. This is exactly the research doc's thesis — *"the AI does the work; the human confirms"* — and it is the more-ethical form of GONE (it also sidesteps Paycom's worst complaint, "forcing decisions/work onto people"). **Full** auto-decide (removing the human — true Paycom-GONE) is a separate governance decision (`decide_leave` boundary amendment), sequenced as D3 and gated on a WWMD/kernel + founder ruling. It is **not** built until that boundary is formally amended.

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

**Decision perspective (in-app)**
- In-process business gate `lib/decision-perspective/org-business-gate.ts` — `evaluateOrgBusinessDecisionGate(...)` selects the organization's WWWD profile, evaluates scored options, and persists the `DecisionInteraction`. Leave uses `domainClass:"risk-assessment"`.
- Dimension registry `lib/decision/dimension-catalog.ts` (`DIMENSION_KEYS`, `validateOptionFeatures`). Relevant axes already exist: `capacity_utilization`, `business_disruption`, `governance_compliance`, and `reversibility`.
- Surface adapter `lib/workforce/leave/leave-decision-surface.ts` maps only a known approve/deny recommendation from the WWWD gate; all absent, ambiguous, disallowed, or escalation outcomes go to a human. **Link the returned `interactionId` to the `LeaveRequest`.**
- `principle_decide` is the WWMD platform-development surface and is explicitly out of scope for this business decision. The live comparison that established this boundary is retained in D2.2 below.

**Coverage inputs**
- `lib/mcp/packs/staffing-pack.ts` — `getStaffingCoverage({organizationId})` → per-demand `{required, assigned, covered, status}` + `uncoveredCount` (the "are we short-staffed if approved?" input; tool `get_staffing_coverage`, `requiredCapability: view_employee`).
- `lib/workforce/staffing/view/coordinator-view.ts` — `ChangeRow.kind` already models `"leave_approved"` as a coverage-affecting change; `maskEventForCoordinator(...)` enforces the busy-mask privacy contract.

**AI-coworker registration + the reuse precedent**
- Proposal record **`AgentActionProposal`** — `schema.prisma:6218-6244`: `{proposalId, threadId, agentId, actionType, parameters Json, status "proposed"→decidedAt/decidedById/executedAt}`. **The canonical "AI proposes an action over a record, a human decides" table — reuse with `actionType:"leave.decide"`; do not invent a leave-proposal model.**
- Payload precedent `lib/workforce/staffing/coworker/prepare-proposal.ts` — `prepareStaffingProposal(...)` (pure; `autoPublish:false`). Mirror this shape for `leave.decide`.
- Authority boundary `lib/workforce/staffing/coworker/authority.ts` — `authorizeStaffingAction(ctx)`, `requiresHumanApproval(action)`; **`StaffingAction` already includes `decide_leave` as human-only. Extend this module for the propose path; the auto-act path stays blocked until D3.**
- Registration `lib/mcp/packs/coworker-establish-pack.ts` (`establish_coworker`) + `lib/mcp/pack-registry.ts` + grant mirror `lib/tak/agent-grants.ts` (`TOOL_TO_GRANTS`, drift-test enforced). Use the `dpf-establish-coworker` paved road.

**Governed audit write path**
- Leave keeps its manager-authority spine: `approveLeaveRequest` / `rejectLeaveRequest` call `authorizeApprovalDecision`, then write `AuthorizationDecisionLog` allow/deny records around the human decision. The coworker never writes a leave outcome or impersonates that human; its separate `AgentActionProposal` and linked `DecisionInteraction` preserve recommendation provenance.

---

## 3. Coordination with the parallel Greenhouse absorption

The Greenhouse effort (`EP-ECOSYSTEM-ABSORPTION-ARCH`: `BI-E5561DC9` bridge→absorb→replace, `BI-9CC44DC7` recruiting pipeline surface, `BI-02F1F944` hire→`EmployeeProfile` landing, `BI-27456471` **replace** — Harvest extraction + dual-run + cutover + Greenhouse retirement) is **recruiting/ATS**. The active parallel thread is the **replace** phase. **There is no functional overlap** with leave decisioning — hiring vs. absence are disjoint domains. Coordination is purely **shared-infrastructure hygiene + convention consistency**.

> **Sibling payroll-seam thread (epic-level, affects P1 not P2).** A parallel thread built the recruiting→hiring→**paying** seam — `PayRun`/`Payslip` + `computeEmployeePayslip`/`runPayroll`/`markPayslipDisbursed` (boundary: records disbursement status, never moves money). **P1 (Beti / employee-confirmed payroll) rides on that `PayRun`/`Payslip` substrate — it must NOT re-create it.** No overlap with P2 (leave). Noted here so the epic doesn't double-build the pay-run record.

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

### D2 — Propose-only leave-decisioning coworker *(core · this is `BI-4D030159` · independently shippable · ✅ source complete; gates in progress)*
**Deliverable.** A coworker + MCP surface that, on an eligible `LeaveRequest`, (a) reads the canonical leave, balance, calendar, and staffing coverage facts, (b) applies deterministic balance/coverage/consecutive-day/blackout guards, (c) asks the organization's WWWD business-decision gate to recommend approve or deny only when the guards pass, (d) writes `AgentActionProposal(actionType:"leave.decide", status:"proposed")` with the returned `interactionId`, and (e) renders the recommendation and rationale beside the existing human approve/reject controls. The actual state change stays on the governed D1 path, which also settles the proposal record. Neither the coworker nor its tool has leave-mutation authority.

**Build increments (D2 is itself multi-part):**
- **D2.1 — safety core ✅ DONE.** `lib/workforce/leave/leave-decision-policy.ts` — pure `evaluateLeaveGuards()` (the hard rails: overdraw balance / coverage breach / consecutive-day limit / blackout → force escalate) + `resolveLeaveDecision({guards, decisionOutcome})` (guard always wins toward escalation; a clean surface recommendation passes through; ambiguous outcomes escalate by exception). Decision-surface-independent by construction. Verified: 10 vitest cases red→green.
- **D2.2 — decision surface + orchestration ✅ DONE. DESIGN CORRECTION (validated 2026-08-07):** leave uses `evaluateOrgBusinessDecisionGate` (WWWD — the organization's staffing/leave doctrine), not `principle_decide` (WWMD — platform-development doctrine). The pure adapter accepts only known, allowed approve/deny recommendations; the injected orchestration applies hard guards first and never mutates leave state. A missing org stance or ambiguous outcome escalates safely.

**Live functional verification (2026-08-07, against the live org WWWD gate).** Ran the real `buildLeaveScoredOptions` vectors through `evaluate_org_business_decision` for a clean case and a tight-coverage case. Both returned `recommend/approve`, confidence 0.825, **`orgProfileSelected: true`**, with real ledger `interactionId`s (`DI-CEAF442A565D`, `DI-16781F232B81`). Because the option pick is commandment-argmax, coverage tightness remains a deterministic guard via the configurable `minCoverageCushion`; the gate cannot weaken it.
- **D2.2 — I/O wrapper ✅ DONE.** `leave-decision-runtime.ts` reads date-scoped canonical coverage through the extracted shared `staffing-coverage.ts` reader, current balance, and approved overlap, then calls the real in-process WWWD gate. Hard guards short-circuit before the gate.
- **D2.3 — `decisionInteractionId` migration ✅ DONE.** Additive nullable field, data-safe migration attestation, and model-kind Data-Impact manifest. Prisma 7 validate/generate are green; an isolated migration-apply gate remains in local merged-code CI.
- **D2.4 — proposal record ✅ DONE.** The idempotent proposal bundle writes one assistant message + `AgentActionProposal`, links the request to the WWWD interaction, never mutates leave status, and is settled only by D1 after an authorized human decision.
- **D2.5 — MCP pack ✅ DONE.** `propose_leave_decision` is registered with matching least-privilege grants. The pack is immediate only for creation of the proposal artifact; it has no approve/reject authority.
- **D2.6 — surface + coworker ✅ SOURCE DONE.** The existing `/employee` surface now has a local `Time off` view; `LeavePanel` renders recommendation, rationale, guard reasons, and explicit “Human decision” copy beside the existing controls. `time-off-advisor` was established as a confidential draft and mirrored into seed/registry/model/routing/profession sources with a read-only golden journey. Measured UX evidence, canonical runtime verification, and lifecycle certification remain completion gates.
**Verified plan drift.** `LeavePanel` existed but was not mounted. The implementation mounts it as a query-param local view (`/employee?view=timeoff`) under the existing People page. No new user-facing route or navigation layer was created; the internal `/coworker/leave-decision` context exists only for persona, audit, and certification routing.
**Migration note.** Adding `decisionInteractionId` follows the Prisma-7 schema/migration gauntlet (migrate from `packages/db/`, migration-safety attestation for the nullable column, Data-Impact manifest kind `model`, Docs-Impact trailer) — see the Prisma-7 gate memo.
**Verification (functional).** `dpf-tdd`: (1) a safe request produces an approve/deny proposal with a linked `interactionId`; (2) coverage, balance, blackout, and consecutive-day rails escalate without auto-approval; (3) ambiguous/disallowed WWWD outcomes escalate; (4) the proposal never mutates `LeaveRequest.status`; and (5) every human decision routes through D1 and settles the proposal. Then run golden-journey certification for the recommend and escalate paths on the canonical runtime.
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
- **Recommendation over-trust.** A confident-but-wrong WWWD recommendation could bias a human approver. Mitigation: the rationale and guard reasons render beside an explicit “Human decision” label; absent/ambiguous/disallowed outcomes escalate rather than recommend.
- **Peer-session overlap on `lib/actions/leave.ts`.** Another session may be hardening leave. Mitigation: overlap-check the file's recent history before D1 (peers' in-flight work is invisible to `gh pr list`).
- **Migration blast radius.** `decisionInteractionId` is an additive nullable column (data-safe); rollback is a down-migration dropping the column — no data loss.

---

## 7. Sequencing

**D1 → D2 → (decision) → D3.** D1 first (small, safe, closes the audit gap, no boundary issue). D2 next (the delight; propose-only, ships within the existing boundary). D3 is a *decision before a build* — run `dpf-decision-via-kernel` + founder ratification before any auto-decide code exists. Lead the epic with this BI because leave is already at maturity 3 and the kernel exists, so D1+D2 are the cheapest path to a live level-5 coworker.
