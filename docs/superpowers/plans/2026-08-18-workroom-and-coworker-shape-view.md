---
status: active
---

# Shape view for AI coworkers and workrooms — implementation plan

**Umbrella item:** BI-C7E2E924 (large, triaged `build`) · **Epic:** EP-WORK-CONVERGENCE
**Date:** 2026-08-18 · **Scope:** visibility only

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## What this plan is and is not

This is the **visibility** deliverable. It renders the shape of an effort — its gates, their verdicts, and the gated tool use — as a picture with live status, toggleable against the existing detail view.

It does **not** define, change, or extend gate semantics. Check families, veto rules, classification of "consequential", collaboration-shape binding, and receipt content belong to EP-1C37C089 and the TAK specification. This plan consumes their output. Where the gate does not yet record something at the granularity the picture wants, the picture shows less — it never derives a verdict of its own.

## Substrate grounding

Verified against the working tree, not assumed:

| Need | Existing substrate | Status |
|---|---|---|
| Room read model | `apps/web/lib/work-management/room-types.ts` → `WorkRoomView` | Exists; already carries `receipts: ReceiptEnvelope[]`, `participants`, `currentCycle`, `completedCycles`, `boundary`, `projection` |
| Gate verdicts | `receipt-envelope.ts` → `fromDecisionInteraction`, `fromToolExecutionReceipt` | Exists; `ReceiptEnvelope` carries `actionType`, `status`, `actorRef`, `policyRefs`, `enforcementMode`, `trace`, `rawRef` |
| Action gating | `policy-envelope.ts` → `evaluateWorkCasePolicy`, `WorkCasePolicyDecision`, `WorkCasePolicyDenialReason` | Exists; deny reasons are already enumerated and renderable |
| Action catalogue | `action-registry.ts` → `WORK_CASE_ACTION_REGISTRY`, `WORK_ROOM_LIFECYCLE_ACTION_REGISTRY` | Exists; descriptors carry envelope requirements |
| Room surface | `apps/web/components/workspace/work-room/` (Header, Body, Cycles, Participants) | Exists; **renders no graphic at all** |
| Room route | `apps/web/app/(shell)/workspace/cases/[caseKey]/page.tsx` → `WorkCaseDetailView` | Exists |
| Coworker surface | `apps/web/app/(shell)/platform/ai/agent/[agentId]/page.tsx` | Exists |
| Liveness | `list_workrooms` derived verdict (live / lease-expired / build-terminal / idle-stale / no-signal) | Exists; **`updatedAt` is not liveness** |

Two findings that shape the sequencing:

1. **The data is already there.** `WorkRoomView.receipts` already aggregates decision interactions and tool-execution receipts onto the room. This is a projection-and-render problem, not a data-plumbing problem. No new tables, no new MCP tools.
2. **There is no existing shape renderer.** `grep` for `workShape` / `shapeGate` across `apps` and `packages` returns nothing, and `search_specs_and_plans` finds no prior plan. Nothing to extend; build it once and mount it twice.

## Phases

### Phase 1 — Shape projection (internal sequencing, not shippable alone)

Deliverable: a pure projection module that turns a `WorkRoomView` into a renderable graph.

- New: `apps/web/lib/work-management/shape-projection.ts` exporting `ShapeGraph`, `ShapeNode`, `ShapeCluster`, `ShapeNodeState`, and `projectRoomShape(view: WorkRoomView): ShapeGraph`.
- `ShapeNodeState` is a closed enum: `passed | holding | denied | awaiting-confirmation | not-reached`. `holding` and `denied` are distinct; a veto is never averaged into a score.
- Node status derives from live state only — cycle state, boundary gaps, receipt envelopes, and the caller-supplied liveness verdict. `updatedAt` is not an input to the function; enforce this with a test.
- Sequential gates become nodes; concurrent gates become a `ShapeCluster`; terminal outcomes become the ship column.

Verification: unit tests in `shape-projection.test.ts` covering — a clean room, a room holding at one gate, a room with a denied gate, a lease-expired room mid-verify (claim + verify at-risk, everything downstream `not-reached`), and a guard test asserting no `updatedAt` read.

### Phase 2 — Renderer + workroom mount (**shippable**)

Deliverable: the shape view visible on the workroom route, toggleable.

- New: `apps/web/components/workspace/work-room/WorkRoomShape.tsx` — SVG graph, left-to-right, clusters for parallel gates, ship column stacked. State encoded in form (border weight, glyph) as well as colour, so the blocking cluster reads without colour.
- New: `apps/web/components/workspace/work-room/ShapeViewToggle.tsx` — shape / detail selection, persisted per user; detail remains the authority for reading.
- Edit: `WorkRoomBody.tsx` to mount the toggle and the shape view above `WorkRoomCycles`.
- All colour from portal tokens; light, dark, and system-default all resolve. Canvas gets its own `overflow-x: auto`; the page body never scrolls sideways.

Verification: component tests for each `ShapeNodeState`; a test that the toggle choice survives a remount; theme assertion that no colour is declared outside the token set. Functional check on the contributor preview (`dev-portal-start`) against a real room, including a lease-expired one.

### Phase 3 — Coworker mount (**shippable**)

Deliverable: the same renderer on the coworker surface, uniform across all coworkers.

- New: `apps/web/lib/work-management/coworker-shape-projection.ts` — projects one coworker's gated activity into the same `ShapeGraph` type. Same renderer, different projection; no second visual grammar.
- Edit: `apps/web/app/(shell)/platform/ai/agent/[agentId]/page.tsx` to mount it.
- Uniformity is the acceptance bar: no coworker missing the view, no coworker with a bespoke variant.

Verification: a test that iterates the coworker registry and asserts every coworker projects a non-throwing graph — the guard against a per-coworker special case creeping in later.

### Phase 4 — Gate verdict and gated tool-use decoration (**shippable**; paced with EP-1C37C089)

Deliverable: gates and the tool calls they intercepted, rendered on both mounts.

- Extend `shape-projection.ts` to fold `ReceiptEnvelope` rows of decision-interaction and tool-execution kinds onto their nodes: verdict, failing check family and criterion, attempted tool, acting identity and delegated authority, and the receipt's own `rawRef` so the picture links to its audit row.
- Distinguish the four check families visually where the receipt names them. Where it does not, render the verdict without inventing a family.
- Routine, non-consequential calls stay out of the picture: consume the gate's classification, never re-derive it.
- Where a gate binds a collaboration shape, the routing that shape implies is what the graph draws, with participants at their role — human and non-human identically.

Verification: fixture-driven tests per verdict kind (`allow`, `deny`, `ask`, `escalate`) built from real `ReceiptEnvelope` shapes; a test that every rendered verdict traces to a receipt `rawRef`, so the picture and the ledger cannot disagree; a test that a receipt naming no check family renders without fabricating one.

## Risks and rollback

| Risk | Mitigation |
|---|---|
| **The picture disagrees with the ledger.** A rendered verdict not traceable to a receipt becomes the version people believe. | Every verdict carries its `rawRef`; the traceability test in Phase 4 fails the build if one does not. |
| **Forking the verdict model to get ahead of EP-1C37C089.** | Phase 4 reads receipts only. No local inference of allow/deny. Where granularity is missing, render less. |
| **Status derived from `updatedAt`.** A daily heartbeat freezes it for Build Studio capsules, so a dead room renders live. | `updatedAt` is not an input to projection; guard test in Phase 1. |
| **Dark mode breaks** — the failure mode of the existing buried Mermaid asset (`fill:#333` hardcoded). | Token-only colour, asserted in test, checked on the preview in both themes. |
| **A per-coworker bespoke variant.** | Registry-wide projection test in Phase 3. |
| **The graph is too small to read** — the failure that motivated this BI. | Sized against each route's real width on the contributor preview, with its own horizontal scroll. |

Rollback: each phase is additive. Phases 2–4 are behind the view toggle, whose default can be set to detail; reverting a phase removes a view without touching the room or coworker read models. Phase 1 is a pure module with no callers until Phase 2.

## Backlog coverage

Decision: `decomposed`. Umbrella: BI-C7E2E924. Every independently shippable deliverable maps to a live BI.

| Deliverable | Independently shippable | BI | Depends on |
|---|---|---|---|
| D1 — shape projection module | no (internal sequencing; ships with D2) | — | — |
| D2 — renderer + workroom mount + toggle | yes | BI-23DB08BB | D1 |
| D3 — coworker mount | yes | BI-DB302392 | D2 |
| D4 — gate verdict + gated tool-use decoration | yes | BI-405AD4FD | D2; paced with EP-1C37C089 |

**Governed coverage receipt: blocked by BI-B9403248.** `record_plan_backlog_coverage` (v2) was submitted for this plan four times from workroom WC-B0E0E6BE on branch `docs/workroom-shape-view-plan-main`, and refused each time:

| # | Error | State at submission |
|---|---|---|
| 1 | `plan-artifact-invalid` — "Repository DCO author cannot be mapped unambiguously through capsule provenance" | capsule headSha matched; commit authored by the install git identity |
| 2 | `plan-artifact-invalid` — "Repository artifact ownership is missing or ambiguous for this subject" | commit re-authored under the maintainer DCO identity, so the write-once headSha no longer matched the branch head |
| 3 | `traceability-incomplete` — "Current scope baseline could not be resolved" | headSha synced to the branch head, maintainer DCO identity, capsule holding live scope claims and a `status: resolved` changeImpactContract |
| 4 | `traceability-incomplete` — same | as #3, with all requirement/contract/flow/verification refs emptied, proving the deliverable refs are not the cause |

Failures 1 and 2 are the known provenance defect BI-B9403248 (filed 2026-08-16). Failure 3 is a **third, previously undocumented precondition behind them** — recorded on that BI as occurrence 2, finding (c). All three are opaque: none names the offending value or the remedy.

The mapping table above is therefore the coverage of record until BI-B9403248 ships. Every deliverable maps to a live BI; this plan carries no receipt id, and the `**Umbrella item:**` marker keeps it outside the receipt requirement rather than pretending the receipt exists.

## References

- BI: BI-C7E2E924 · Epic: EP-WORK-CONVERGENCE
- Gate spec (consumed, not modified): `docs/superpowers/specs/2026-08-13-wwwd-constitutional-alignment-gate.md` (EP-1C37C089)
- Standards family: `docs/architecture/agent-standards-family.md`
- Conceptual overview diagram (stays as-is): `docs/architecture/unified-development-tracking.md`
- Reference rendering: https://claude.ai/code/artifact/25770045-bcf0-475b-96a6-51a9300ff854
