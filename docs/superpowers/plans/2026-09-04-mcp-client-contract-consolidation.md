---
status: draft
---

# MCP client contract consolidation implementation plan

Parent: BI-DC0F14E0. Authoring Workroom: WC-B2E2DA53.
Design and acceptance authority: [consolidation design](../specs/2026-09-04-mcp-client-contract-consolidation-design.md).
Evidence: [cross-client audit](../audits/2026-09-04-mcp-client-contract-review.md).

**For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

This draft sequences three existing repair items. It does not assert design approval, plan approval, valid coverage or restored reviewer routing. Implementation starts only after the relevant readiness gates and immutable plan coverage pass. The broader exposure catalog remains a separate peer-owned follow-up; this plan does not claim it.

## Backlog coverage

Decision proposed: decomposed. Coverage is blocked: no initiative scope baseline exists for BI-DC0F14E0. The server rejected the coverage write with `traceability-incomplete` against commit `f51bd8e6cb7002e510552190a75f7620a61cdeeb`, plan blob `bb8abc20072280332451ecdd412dacba41c1f19b`; no valid coverage receipt was issued.

The prescribed recovery was executed once: `claim_backlog_item_for_work` on the existing Workroom with `workIntent: implementation`. Decision `IRD-52AD360FFE11` returned `profile: doc-only`, `verdict: allowed`, no unmet gates and no `recovery.reviewerRoutes`. Thus the coverage writer requires a spec-approved baseline that its recommended doc-only readiness route does not request. No reviewer is dispatched. Resolve this parent-profile/coverage mismatch through the existing governance owner; do not reclassify the documentation item, invent a reviewer packet or repeat identical coverage calls. Once a valid baseline and authorized route exist, rebind coverage to the then-current immutable plan and obtain independent plan review before implementation.

| Deliverable key | Live BI | Requirements | Contract | Flow | Verification | Hard dependency |
| --- | --- | --- | --- | --- | --- | --- |
| recovery | BI-CF118B6D | AC-MCP-RECOVERY 1–6 | CT-MCP-RECOVERY | FLOW-MCP-AUTHOR | VERIFY-MCP-RECOVERY | None |
| coverage | BI-4BB68EB6 | AC-MCP-COVERAGE | CT-MCP-COVERAGE | FLOW-MCP-MEASURE | VERIFY-MCP-COVERAGE | None |
| traversal | BI-3CE72645 | AC-MCP-PAGE | CT-MCP-PAGE | FLOW-MCP-LIST | VERIFY-MCP-PAGE | None |

Each row is independently shippable and maps to an existing open BI. Recommended execution order is recovery, coverage, traversal. This order is not a blocking dependency: recovery can prove its journey without repaired aggregate metrics, and pagination does not require reviewer changes. Claims of aggregate savings require complete measurement. Reuse these mappings in the coverage tool; do not create duplicate BIs.

## Phase 0 — readiness and impact resolution

Internal sequencing, not an independent deliverable. On each implementation branch, refresh source, claim exact paths and consume that Workroom's `verificationState.changeImpactContract`. Include every returned testImpact and guardObligation in the slice. Unresolved impact requires resolution and exhaustive verification, not an exemption. The authoring room's docs-only contract has no testImpact or guardObligation and identifies the generated doc index; it does not cover future runtime edits.

Read current BI readiness, publish the immutable design/plan and follow supported reviewerRoutes when available. Preserve author/referee separation. Record successful coverage and independent review receipts before implementation. If prerequisites fail, retain the exact field, repair and responsible role; never claim a reviewer is pending without a real dispatch. Do not take over WC-375F098A or its closeout branch.

## Phase 1 — recovery and reviewer visibility

Independent deliverable: BI-CF118B6D, VERIFY-MCP-RECOVERY. Grounded edit candidates under `apps/web/lib/`: `backlog/initiative-readiness/readiness-guidance.ts`, `canonical-artifact-discovery.ts` in that same directory, `tak/initiative-readiness-tool-grants.ts`, `work-capsules/governed-work-claim.ts`, `work-capsules/mcp-handlers.ts` and `mcp/packs/work-capsules-pack.ts`. Inspect existing consumers and associated tests before choosing exact scope.

1. Reproduce missing base/head through the advertised adoption schema, handler and persisted Workroom; retain the valid identity fields. Add failing boundary cases for read/transition disagreement and misleading sign/push advice.
2. Consolidate duplicate recovery guidance into the existing projector. Validate complete repair packets against the actual adoption input contract. Separate prerequisite errors and provider failures from confirmed reviewer absence.
3. Project existing reviewerRoutes and TaskRun lifecycle into readiness, detail and list consumers. Use real dispatch ids for pending work and terminal state for failed, cancelled or completed work. Do not introduce a second status ledger. Check discovery responses without revealing ungranted inventory.
4. Execute AC-MCP-RECOVERY 1–6, including the external-author journey with separate reviewer identity and persisted approval readback. Verify list/detail/readiness agree and the operator can identify the next action. Never substitute mocked reviewer authorization for the only integration test.

Risk: inconsistent consumers or accidental authority expansion. Rollback: revert this slice's projection changes together; preserve existing receipts and Workroom identity. No schema migration is planned; any discovered need requires explicit design revision.

## Phase 2 — complete measurement and scheduled action safety

Independent deliverable: BI-4BB68EB6, VERIFY-MCP-COVERAGE. Grounded edit candidates: `apps/web/lib/operate/mcp-call-efficiency/report.ts`, its existing analyzer/consumer tests, and `apps/web/lib/queue/functions/mcp-call-efficiency-scan.ts`.

1. Add fixed-range fixtures below and above 5,000 rows, tied timestamps, a newest-window failure, late arrivals and an empty window. Compare with an authoritative count under explicitly chosen snapshot semantics.
2. Refactor the existing ToolExecution loader into bounded aggregation or stable `(createdAt,id)` traversal. Return requested/observed ranges, counts, completeness and checkpoint provenance. Resolve late-arrival semantics explicitly; changing ascending to descending is not sufficient.
3. Apply the contract to both interactive and scheduled consumers. A partial scan may issue a labelled diagnostic with bounds and continuation. Assert zero corrective BI creation and zero AI Ops dispatch for partial scans; complete eligible scans retain existing governed behavior.
4. Run AC-MCP-COVERAGE and record query duration/memory, denominators and refusal classification. Verify the daily consumer with a day exceeding its scan budget; do not extrapolate fixed missing hours from the seven-day sample.

Risk: scan cost, inconsistent snapshot counts and duplicate automated actions. Rollback: revert the aggregation slice while retaining a conservative prohibition on corrective actions from unproven coverage; test that retained protection explicitly.

## Phase 3 — typed traversal across clients

Independent deliverable: BI-3CE72645, VERIFY-MCP-PAGE. Grounded edit candidates: `apps/web/lib/mcp/packs/work-capsules-pack.ts`, `work-capsules/mcp-handlers.ts`, `work-capsules/liveness-inventory.ts`, `actions/work-capsules.ts` under the same lib root, `apps/web/lib/tak/tool-result-budget.ts`, and `apps/web/app/api/mcp/v1/route.ts`.

1. Inventory input/output shapes and legacy text/structured consumers. Reproduce the destructive preview and lack of traversal above 100 records before editing.
2. Reuse existing pagination primitives where fit is proven; implement compact summaries, opaque continuation, completion and stable order/filter semantics. Validate authority and filters on every request. Keep oversized records identifiable with a supported detail route.
3. Preserve typed counts, liveness and continuation at the transport boundary. Measure page bounds on supported Claude Code, Codex and generic MCP configurations. Client size hints are optional tuning; verify the config adapter before emitting host settings and do not assume persistence from a truncation budget.
4. Run AC-MCP-PAGE: traverse a fixed population with no omissions/duplicates; exercise concurrent changes, long records, filters and denied access across pages. Confirm legacy consumers work and a host cannot truncate away the only continuation at supported bounds. Read saved content back before claiming disk persistence.

Risk: cursor incompatibility, misleading population totals and data loss at either boundary. Rollback: revert the versioned additive slice; retain legacy inputs and detail access throughout. Do not raise caps as the correctness repair.

## Completion and refactoring budget

Allocate 20–30% of implementation effort to shared projectors, duplicate guidance removal and reusable bounded result/aggregation primitives. Record independent definitions removed and consumers verified. Formatting is not refactoring evidence. Avoid a generic orchestrator or new ledger.

For each slice, run affected unit/integration tests and fast source checks, then verify the real journey in the supported nonproduction environment through its lease. Cloud merge-queue checks own the heavy build. Classify migration and UX verification explicitly in completion evidence; show operator state for recovery and client usability for traversal. Keep client/version, negotiated protocol, source SHA and tier with each benchmark. Record evidence and update the BI only when its acceptance passes. Do not report deployment or end-to-end recovery from documentation checks.

After these slices, use design section 5 for the existing BI-1BA8F46C exposure/hook work. It is mirrored from the paired installation and was not edited here. Its owner must incorporate the two discovery paths and rendered hook-purpose/trust checks before implementation. Protocol migration remains outside this plan.
