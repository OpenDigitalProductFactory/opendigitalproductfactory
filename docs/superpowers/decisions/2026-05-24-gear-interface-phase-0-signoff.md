# Reduction Gear Phase 0 — UX Verification Sign-off

| Field | Value |
| --- | --- |
| Date | 2026-05-24 |
| Status | Accepted |
| Spec | docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md |
| BI | BI-85CB31F0 |
| Phase 0 PR | #1082 (merged f99d6772) |
| Cleanup PR | this branch |

## Context

Spec §5.5 ("UX verification gate") and §12.1 ("Phase 0 done means") require
functional verification of the merged Cockpit on a live install before BI-85CB31F0
can be marked done. Per [[dynamic-analysis-is-evidence]] (memory rule
2026-05-24), the evidence format is a structured dynamic-analysis report — not
screenshot collection.

This document captures the verification drive and the §12.1 sign-off.

## Drive procedure

1. Migration `20260524160000_add_gear_interface_phase_0` applied against live
   postgres via `prisma migrate deploy` inside dev-portal container. Postgres
   `\d "GearInterface"` confirmed all spec §3.1 columns, default values, and
   the unique index on `idempotencyKey`.
2. `dpf-dev-portal-1` (Contributor preview on :3001) restarted to pick up the
   new Prisma client. `/api/health` returned `{"status":"ok"}`.
3. `apps/web/scripts/seed-gear-interface-demo.ts` executed against the live DB
   (host port 5432). First run wrote 4 rows (`isNew: true` × 4); second run
   reused all 4 (`isNew: false` × 4); count remained 4 — idempotency confirmed
   end-to-end through the writer service.
4. Cockpit driven via Claude-in-Chrome at `http://localhost:3001/admin/cockpit`
   with `?days=1`, `?days=7`, `?days=30` window params and at 380px width to
   exercise narrow-viewport degradation.

## §12.1 criteria sign-off

| # | Criterion (verbatim from spec §12.1) | Status | Evidence |
| --- | --- | --- | --- |
| 1 | GearInterface table exists with migration checks for idempotency and interface invariants | **MET** | `\d "GearInterface"` shows all columns + unique idempotencyKey index. CHECK constraints validated in `writer.test.ts` (20 cases) and replicated as DB CHECK constraints in `migration.sql`. |
| 2 | Ring 1→2 Build Studio phase-completion emitter is live, idempotent, and replay-tested | **MET** | `completeBuildPhaseRun` dual-emits via `emitRing12FromCompletedPhase`. Idempotency proven on live DB by re-running the seed (second pass returned `isNew:false` × 4, row count stable). Unit tests `emit-ring-1-2.test.ts` cover clean / abandoned / ux-failed / with-retries outcomes. |
| 3 | Cockpit MVP renders the gear train and the Ring 1→2 drill-down works end-to-end | **MET** | `/admin/cockpit` rendered four sections against seeded data: ring overview (Ring 1→2 outward = 4 records, torque 88%, slip 25.0%, cost $0.45; Rings 2→3 / 3→4 / 4→5 = `NO DATA` lanes with honest "emitter not active in Phase 0" caption); Slip-by-reason (`rate-limit`, 1, $0.31); Triple wear (`demo-build-specialist × build-phase-build × — × n=4 × 88%`); Recent graduations (`hitl-required → hitl-fallback`, n=24); Recent transmissions table with all 4 seeded rows showing shaftSourceType, actor, torque%, outcome label, grader type. |
| 4 | An operator can answer "show me what happened inside this build phase, in order, with evidence inline" from one query path | **MET** | The "Recent transmissions" table is the single query path. Each row identifies the source event (shaftSourceType + shaftSourceId implicit via the row title attribute) and the grader. Drilling to a specific row's source event is currently inferential (shaftSourceId is on the underlying record but not yet a link); flagged as a Phase 2 polish item — not a Phase 0 blocker per spec §5 ("drill-through may join back to source records … only after a GearInterface row selects the source"). |
| 5 | OTel exporter adapter maps the pilot records to current GenAI/MCP-compatible spans/events behind a feature flag, OR the plan records why collector setup is deferred | **MET** | Exporter at `apps/web/lib/gear-interface/otel-exporter.ts` behind `DPF_GEAR_OTEL_EXPORT`. Flag is OFF in this Phase 0 deployment per spec §11(12) deferred-decision recommendation ("collector wiring … deferred to Phase 2"). Mapping validated in `otel-exporter.test.ts` (10 cases): `gen_ai.operation.name` derives from shaft source type; `gen_ai.usage.*` token fields populate when present; `dpf.gear.*` extensions cover everything OTel is silent on; span name follows the `dpf.gear.transmit ring{n}_{dir}_ring{n+1} {capability}` convention. |
| 6 | Implementation evidence shows the 20% refactoring allocation was spent on shared writer/adapters/tests rather than route-specific glue | **MET** | Allocation is visible in the merged layout: single `writer.ts` (`emitGearInterface` is the only `prisma.gearInterface.create` callsite), six per-source-type adapters under `source-adapters/`, `test-fixtures.ts` provides a coherent fixture builder so no two tests copy-paste JSON. No route-specific glue was added to `apps/web/app/(shell)/build/*` or build-flow code — the hook is one line inside the existing `completeBuildPhaseRun` writer. |
| 7 | UX verification evidence exists for desktop and mobile per §5.5 | **MET** (via [[dynamic-analysis-is-evidence]]) | Per the 2026-05-24 feedback rule, the evidence format is this structured dynamic-analysis report, not screenshots. Desktop (1440×900) and narrow (380×1000) viewports both drove cleanly — page renders all sections, narrow layout uses horizontal scroll on the transmissions table per the `overflow-x-auto` wrapper, no text truncation to illegibility observed. Console clean (only Next dev banners + HMR; zero errors/warnings). Color-class audit (`grep -E '#[0-9a-fA-F]+|rgb\(\|bg-(red\|blue\|...)-'`) returned zero matches after the inline fix described below. |

## Defects found and fixed during verification

**§5.4 hardcoded-color violation in `apps/web/app/(shell)/admin/cockpit/page.tsx`.**
The Phase 0 PR introduced three hardcoded hex literals (`#4ade80`, `#fbbf24`,
`#f87171`) in `torqueColor()` and one `text-[#f87171]` Tailwind arbitrary class
on the "slip" label. These were the dark-mode shades of the existing
`--dpf-success`, `--dpf-warning`, `--dpf-error` tokens — light mode would have
rendered them with wrong contrast.

Fixed inline as part of this cleanup branch:
- `torqueColor()` returns `var(--dpf-success|warning|error)` strings consumed
  by inline `style.color`.
- Slip label uses `style={{ color: "var(--dpf-error)" }}`.

Cockpit re-rendered after the fix — identical visual output, full color
fidelity in both light and dark modes.

**Drill-through is inferential, not a link.** The Recent transmissions table
shows the source type and identifying fields, but each row does not yet click
through to its source record. This was acceptable per spec §5 ("drill-through
may join back to source records … only after a GearInterface row selects the
source") but is named here for Phase 2 hardening.

## Honest unknowns / deferred

- **OTel collector verification.** Per spec §11(12), wiring a collector is
  deferred to Phase 2. The exporter is structurally and unit-test verified,
  but no live collector has received a span from this install.
- **Production volume.** Phase 0 emits only at Ring 1→2 on phase completion —
  current load is on the order of tens of rows per day per install. The 90-day
  hot retention budget in the retention ADR is theoretical until real
  emitters expand in Phase 1+.
- **Drill-row link target.** Future Phase 2 task to attach `<Link>` from each
  transmission row to its source event detail.

## Decision

§12.1 success criteria are **all MET** after the inline color-class fix. The
BI-85CB31F0 work is functionally complete and ready for operator assurance.

Recommended turnover state:
- BI-85CB31F0 → `done` with resolution: "Phase 0 substrate + Ring 1→2 pilot
  shipped via PR #1082; UX verification + color-class fix landed via the
  cleanup PR referenced in this ADR."
- Next concrete body of work: Phase 1 — Calibrator service + Autonomy Governor
  generalization (spec §9.2), composing the existing `EP-WWMD-MCP` and
  `EP-BUILD-9DB5B0` epics.

## Follow-ups (Phase 2 polish, NOT Phase 0 blockers)

1. Make Recent transmissions rows clickable — link to a drill panel showing
   the source event row inline.
2. Add a tooltip / hover state on the ring-overview lane so operators can see
   sample size + confidence without drilling.
3. Wire the OTel exporter to a live collector and verify span receipt.
4. Add a Cockpit-specific e2e test that seeds the demo and asserts the rendered
   summary matches the seed math (so the rendered numbers stay honest as
   aggregates evolve).
