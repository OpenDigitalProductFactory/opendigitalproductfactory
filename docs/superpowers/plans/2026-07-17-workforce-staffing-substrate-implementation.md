# Workforce staffing & scheduling substrate — implementation plan

| Field | Value |
| --- | --- |
| Backlog item | `BI-4AD09A35` (Organization workforce staffing and scheduling substrate) |
| Epic | `EP-WORKFORCE-OPS` |
| Design spec | [`2026-07-17-organization-workforce-staffing-scheduling-design.md`](../specs/2026-07-17-organization-workforce-staffing-scheduling-design.md) |
| Kernel records | `DI-C8BF6362B44C` (architecture: DPF domain + open solver adapter) · `DI-78788D22BE65` (solver-first: Timefold) |
| Branch | `feat/workforce-staffing-substrate` (Phase 1) · `feat/workforce-staffing-constraints` (Phase 2) |
| Status | Phase 1 built + PR'd (#3204); Phase 2 constraint core built |

## Founder decisions applied (design §18)

1. **Golden model:** appointment coverage (healthcare/beauty) **+** one trades field-crew — exercises three of the five demand shapes (`fixed_slot` + `coverage_floor` + `task_pipeline`). Chosen to also serve the in-flight `EP-HEALTHCARE-PRACTICE`.
2. **Publish authority:** owner/operator capability only initially; scoped delegation (location/team) added after verified usage.
5. **Jurisdiction pack:** US federal (FLSA) + California first (richest rule set — daily OT, meal/rest premiums, reporting-time incl. *Ward v. Tilly's*, split-shift). Install `employsIn` + work-location jurisdiction must be populated before the pack is authoritative.
6. **Solver:** **Timefold Community Edition first** in the packaging spike (kernel-recommended, `DI-78788D22BE65`, high confidence — Architecture Over Shortcuts favoured Timefold's native hard/medium/soft model). OR-Tools CP-SAT remains the documented fallback; the provider-neutral adapter keeps the switch cheap.

## Grounding (verified substrate, fresh worktree 2026-07-17)

- Schema: [`packages/db/prisma/schema.prisma`](../../../packages/db/prisma/schema.prisma) (13,567 lines) — `EmployeeProfile`:389, `Principal`:307, `Organization`:3663, `PersonLicenseRecord`:4186, `AgentActionProposal`:4995, `LeaveRequest`:7556, `CalendarEvent`:7643, `ServiceProvider`:9070, `ProviderAvailability`:9108, `DecisionInteraction`:11924. New aggregates **link** these; none is duplicated.
- Migrations: timestamp-prefixed dirs under `packages/db/prisma/migrations/`; latest is `20260717035500_*`. New migration must use a later stamp (avoid the timestamp-collision hazard).
- Coordinator UX home: [`apps/web/app/(shell)/employee/page.tsx`](../../../apps/web/app/(shell)/employee/page.tsx) renders [`EmployeeTabNav`](../../../apps/web/components/employee/EmployeeTabNav.tsx) with flat `?view=` switching — the design §15.1 `?view=staffing` home fits with no new global nav.
- MCP tools: packs in [`apps/web/lib/mcp/packs/`](../../../apps/web/lib/mcp/packs/); `query_employees` lives in `workforce-pack.ts` and registers through [`pack-registry.ts`](../../../apps/web/lib/mcp/pack-registry.ts). New staffing tools extend a pack with deny-by-default grants.
- Calendar merge: [`apps/web/lib/workforce/calendar-data.ts`](../../../apps/web/lib/workforce/calendar-data.ts) — the §3.3 `employeeProfileId` scoping gap is a Phase 7 prerequisite before private staffing projections depend on it.

## Phase sequence

Each phase becomes a child BI under `EP-WORKFORCE-OPS`. Phase 1 ships independently; later phases depend on earlier ones. Every phase carries functional verification, not just typecheck.

### Phase 1 — Core staffing schema + migration *(ships independently)*

**Deliverable.** The nine design aggregates (§5.1) as Prisma models with the §9.9 refinements:
- `StaffingDemand` with a `demandShape` enum discriminator (`coverage_floor | forecast_curve | fixed_slot | task_pipeline | census_load`), provenance, effective version.
- `StaffingShift`, `StaffingAssignment` (lifecycle incl. the offer/claim states `offered → claimed → confirmed → on_site` alongside `proposed/confirmed/declined/withdrawn/completed`), `EmployeeAvailabilityWindow`, `EmployeeSchedulingPreference`, `StaffingConstraintRule`, `StaffingProposalRun`/`StaffingProposalOption`, `StaffingExceptionRequest`, `WorkforceCandidateFact`.
- Typed crew/composite-resource assembly + co-scheduled resource links (vehicle/room/operatory/kit) so double-booking detection covers equipment and rooms.
- Optimistic-concurrency version columns; append-only/event-versioned assignment history; instant + decision-timezone + local-date storage.

**Files.** `packages/db/prisma/schema.prisma` (new models + enums, additive only); new `packages/db/prisma/migrations/<stamp>_add_workforce_staffing_substrate/`; `pnpm --filter @dpf/db generate`.

**Verification.** Migration applies clean on a DB that already holds data (additive `CREATE TABLE` only); `prisma validate`; typecheck; a unit test asserting model presence, the overlap invariant (no overlapping confirmed assignments unless a typed operating model permits), version columns, and idempotency keys.

**Risk/rollback.** Additive migration referencing existing PKs — no change to existing tables; rollback = down-migration dropping the new tables (nothing else references staffing yet).

### Phase 2 — Deterministic constraint & rule-pack engine *(core built)*

**Deliverable.** Typed predicate registry implementing the §9.8 families + a
starter rule-pack. **Built in this slice** ([`apps/web/lib/workforce/staffing/`](../../../apps/web/lib/workforce/staffing/)):
the normalized problem model (`constraints/types.ts`), seven predicates
(`constraints/predicates.ts`) — `credential_eligibility` (expiry-aware),
`capability_presence`, `min_n_together` (dual control), `pairing_ratio`
(apprentice:journeyman), `rest_gap`/turnaround, `no_overlap`, and
`max_hours_premium` (priced, not infeasible) — the registry + fail-closed
evaluation loop (`constraints/evaluate.ts`), and the US-federal + California
starter pack (`rule-packs/us.ts`). Unknown jurisdiction OR an unknown hard
predicate → **requires policy review**, fail-closed (never assume US defaults).

**Follow-up (same phase, later PRs):** the remaining §9.8 families
(fair-workweek predictability pay, meal/reporting-time premiums, minor-hour
windows, on-call compensability, headcount-formula, per-group overtime-regime
selection), effective-dating, and DB-backed rule loading from
`StaffingConstraintRule` rows.

**Verification.** Constraint goldens — passing + violating fixture per predicate,
unknown-jurisdiction and unknown-predicate fail-closed tests, priced-premium
test, starter-pack resolver test (14 tests, `constraints/evaluate.test.ts`).

### Phase 3 — Solver adapter + Timefold packaging spike

**Deliverable.** Provider-neutral adapter: accepts a normalized, versioned problem, returns candidate solutions + machine-readable score/violation detail; **no** DB read, notification, publish, or exception authority. Timefold CE spike as a bounded internal sidecar service (not embedded in the Node/Alpine image): license/SBOM/provenance review, ARM64/AMD64 container sizing, determinism + timeout tests, offline operation, failure semantics. DPF performs identity resolution, applicability, and **independent hard-rule validation after solve**.

**Files.** `apps/web/lib/workforce/staffing/solver/adapter.ts` (interface + normalized problem/solution types); solver sidecar service dir + Dockerfile; compose wiring (one `dpf` project).

**Verification.** Deterministic fixtures → stable solutions; feasible/infeasible/unknown/timeout each handled; independent post-solve validation catches any solver hard-rule violation; sidecar builds on both arches; documented OR-Tools fallback path.

### Phase 4 — AI Staffing Coworker proposal flow + human-authority boundary

**Deliverable.** Phase-1 coworker authority (design §11): read governed facts, prepare demand, run validation/optimization, compare options, create `AgentActionProposal` with typed staffing links (reuse existing governance substrate). Cannot publish or message employees without approval. Publish/exception/leave/notify require a valid actor + delegation + evidence; publish authority bound to the owner/operator capability (decision 2), delegable by scope later.

**Files.** `apps/web/lib/workforce/staffing/coworker/`; governance links reuse `AgentActionProposal`/`DelegationGrant`/`DecisionInteraction`.

**Verification.** No publication/exception/notification without a valid actor + evidence record; a proposal never mutates assignments; delegation scope enforced.

### Phase 5 — MCP staffing tool pack

**Deliverable.** New `staffing-pack.ts` (or a scoped extension of `workforce-pack.ts`): read tools (coverage, unscheduled demand, minimum-necessary availability/eligibility outcomes), proposal tools, employee availability/preference write tools — all deny-by-default grants. Registered via `pack-registry.ts`.

**Files.** `apps/web/lib/mcp/packs/staffing-pack.ts` + test; `pack-registry.ts` registration.

**Verification.** Pack tests (grant shapes, tool contracts); tools callable via MCP JSON-RPC against the running portal.

### Phase 6 — UX surface: People → Staffing (golden = appointment + field-crew)

**Deliverable.** Extend `/employee` with `?view=staffing` (coordinator) per §15.1; first viewport per §15.2 (planning window, team/location scope, coverage status, unscheduled demand, hard conflicts, last-minute changes, pending decisions; actions Prepare / Compare / Approve-and-publish). Comparison of 2–4 options with the §8.3 explanation contract. Employee "my schedule / availability" scoped to self; approver deep-links from the attention inbox. Golden seed/demo data for one appointment-coverage archetype + one trades field-crew.

**Files.** `apps/web/app/(shell)/employee/` (staffing view components); `apps/web/components/employee/` (staffing components); demo/seed data.

**Verification.** Live portal (contributor preview :3001) — coordinator happy path, employee correction, infeasible ("no feasible schedule") explanation without fabricated fill, private-title redaction, keyboard/accessible table operation, employee-timezone clarity.

### Phase 7 — Calendar & comms projections

**Deliverable.** Project confirmed assignments into `CalendarEventView` (no second canonical calendar copy); harden `calendar-data.ts` `employeeProfileId` scoping (§3.3 prerequisite) before private staffing projections depend on it. Comms candidate-fact flow (time-off intent → employee confirmation → `LeaveRequest(pending)` → approved-leave hard constraint → repair proposal); minimal source envelope only.

**Files.** `apps/web/lib/workforce/calendar-data.ts` (scoping fix); `apps/web/lib/workforce/staffing/projections/`; candidate-fact ingestion module.

**Verification.** Assignment publishes to calendar projection; coordinator never sees private event titles (busy mask); a `WorkforceCandidateFact` is never directly solver-authoritative; approved leave becomes a hard unavailability interval.

### Phase 8 — Verification & live-install evidence

**Deliverable.** Execute the full §17 verification model: domain invariants, constraint goldens, solver parity, fairness/privacy (access matrix, redaction, protected-data exclusion, no hidden per-person score), comms, human authority, UX, deployment (AMD64/ARM64, offline solve, upgrade/rollback, SBOM/license), and live-install evidence via a governed nonproduction lease.

**Verification.** Success metrics per §17: zero hard-violations on published schedules; correction/override/decline rates tracked; no publication/external write without actor+delegation+evidence; live happy-path verified on the running install.

## Cross-cutting risks

- **Solver runtime weight** (Phase 3): a JVM sidecar adds image/footprint. Mitigation: bounded sidecar (not embedded), spike gate before adoption, OR-Tools fallback preserved by the adapter.
- **Migration safety** (Phase 1): additive only; use a stamp later than `20260717035500`; never rename an applied migration.
- **Authority creep**: the solver and coworker have zero side-effect authority by contract; independent post-solve hard-rule validation is mandatory. Enforced in Phases 3–4 verification.
- **Privacy**: protected/medical reasons never reach coordinator-visible constraints; the staffing view receives only minimum-necessary outcomes. Enforced in Phases 6–8.

## Definition of done

`BI-4AD09A35` acceptance criteria (§ its body) hold on a live install: canonical staffing authority with separation from leave/credentials/identity/calendar; demand-shape discriminator + multi-shape assignable units; constraint predicate registry covering the §9.8 families; side-effect-free provider-neutral solver with post-solve validation; fail-closed unknown jurisdiction; monetized time-shape premiums; no hidden fitness score; human authority on every consequential action.
