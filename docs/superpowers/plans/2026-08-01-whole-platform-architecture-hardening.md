# Whole-Platform Architecture Hardening Implementation Plan

**Umbrella BI:** BI-C04CAD7F

**Epic:** EP-413F2602

**Coverage receipt:** `cmsaidchj02z601qk8qaedqsw`

**Decision ledger:** DI-3E51F83DB869 (`umbrella-links`, high confidence, no commandment conflict)

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Turn the 2026-08-01 whole-project architecture review into a sustained hardening program. The program establishes enforceable application boundaries, removes transport coupling, makes architecture documentation derive from canonical runtime contracts, gives data and code debt accountable burn-down paths, repairs shared reporting composition, and adds system-level quality-attribute evidence.

This is a hardening program, not a single rewrite. Existing concern-owned BIs remain in their current epics; this plan coordinates their outcomes and adds only uncovered work.

## Evidence baseline

- `apps/web/lib` is the dominant coupling center: `actions`, `integrate`, `tak`, `routing`, `mcp`, and `build` are the largest areas.
- The eight initial governed contexts have 498 measured production cross-context import statements. The minimum-feedback ordering found from current edge weights is `mcp → actions → queue → integrate → build → tak → inference → routing`; 65 reverse imports are explicit debt rather than silently permitted architecture.
- Forty API route files import 16 server-action modules; some action modules own session auth or Next.js revalidation.
- The Prisma schema is roughly 16k lines and 560 models. Live conformance showed 247 FK-without-index warnings, 86 orphan-model findings, and 15 consolidation findings.
- Current guards carry meaningful debt: oversized modules, local helpers, raw route errors, provider-local lifecycle logic, raw tables, loading indicators, and retired process references.
- The UX route baseline contains 200 routes; 196 record at least one axe violation, while several operator routes have extreme word/control density.
- Static guards are broad, but no system suite jointly exercises upgrade/rollback, restore, queue saturation, concurrency, provider loss, capability failure, and representative load.

## Research and benchmarking

- ISO/IEC/IEEE 42010 supplies the architecture-description frame: stakeholders, concerns, viewpoints, and correspondence between views.
- ISO/IEC 25010 supplies the quality model used by the fitness suite.
- CMU SEI ATAM supplies the utility-tree/scenario method for prioritizing quality attributes and trade-offs.
- ArchUnit demonstrates executable dependency rules close to the codebase.
- dependency-cruiser and Nx demonstrate graph visualization and affected-boundary checks. DPF adopts the executable-graph pattern but initially uses a dependency-free Node implementation to avoid adding a tool whose value is not yet proven.
- WCAG 2.2 and Playwright accessibility snapshots remain the UX structural standard; the existing route-budget program owns route remediation.

## Architectural alignment

- Deployment contracts: no new service, port, container, or host dependency.
- Canonical identity: ActorContext adapts the existing principal/effective-auth substrate; it does not add a parallel identity store.
- Data authority: PostgreSQL remains canonical. Data hardening classifies existing models and relations rather than adding a second model catalog.
- Shared primitives: existing CI guard registry, report-kit, route-budget, capability manifest, and evidence tools remain authoritative.
- Rule ownership: this plan points to `AGENTS.md` and kernel principles; it does not restate operational doctrine as a competing source.

## Delivery sequence

### Phase 1 — Establish application boundary evidence (BI-2E9F6D37)

**Deliverable:** a versioned context registry, acyclic target order, file-level exception baseline, executable guard, tests, CI registration, and architecture guide.

**Initial files:**

- `scripts/application-boundaries.json`
- `scripts/check-application-boundaries.mjs`
- `scripts/check-application-boundaries.test.mjs`
- `scripts/lib/ci-policy-guards.mjs`
- `package.json`
- `docs/architecture/application-boundaries.md`

**Verification:** fixture tests must prove alias and relative-import resolution, unknown-context detection, cycle rejection, new forbidden-edge rejection, stale-exception detection, and valid shrinkage. Run the guard against the repository and through the source policy-guard profile. Production build is still required before PR handoff because the CI registry changed. UX and migration are not applicable: no rendered surface or schema changes.

**Rollback:** revert the guard/registry/CI registration as one concern-sized change. Do not weaken a failing rule by expanding the baseline without an evidence-backed architecture decision.

### Phase 2 — Separate identity/authorization from transports

1. **BI-963F4226:** introduce transport-neutral ActorContext and application-service conventions, coordinated with BI-BD43D871.
2. **BI-58810028:** migrate Finance payment-run plus representative read/mutation flows as the parity canary.
3. **BI-71345FF0:** migrate remaining API-route → server-action dependencies context by context and burn the guard baseline to zero.

**Verification:** characterization tests precede extraction; bearer/session parity, tenant isolation, disabled principals, capabilities, validation, idempotency, error mapping, and revalidation ownership are verified per cohort. Exercise the affected API and browser paths against the governed runtime.

**Rollback:** retain edge adapters so a context cohort can revert independently without restoring duplicated domain logic.

### Phase 3 — Reduce high-coupling clusters (BI-B970B01D)

Use Phase 1 graph metrics to choose reciprocal-edge and oversized-module cohorts. Extract typed ports/orchestration interfaces, preserve behavior with characterization tests, and require a measured reduction in reciprocal dependencies or module responsibility per PR.

Coordinate with BI-PSC-004, BI-ECO-004, and BI-ECO-005 so execution, integration receipts, and shared company primitives are not reinvented.

### Phase 4 — Make architecture state self-describing (BI-FDA5DC4C)

Follow PR #3871. Generate volatile architecture inventory sections from canonical capability/package/compose contracts, while leaving explanatory prose human-authored. Add deterministic drift tests and derived-artifact registration.

### Phase 5 — Converge the data model (BI-5881E707 + BI-PSC-006)

Classify every live FK/index, orphan, and consolidation finding by bounded context and intent. Add only evidence-backed indexes through forward-only migrations; record intentional projection/append-only models without invented relations. Establish owned shrink-only conformance gates.

**Migration verification:** every migration applies to representative existing-data states, not only a blank schema. Query plans and workload evidence must justify new indexes.

### Phase 6 — Turn debt inventories into budgets (BI-7B803E60)

Extend existing guards with owner, rationale, target, review/expiry, and trend evidence. Initial cohorts: module size, raw route errors, local `isRecord`, local status-color maps, connector lifecycle debt, raw tables, loading indicators, and retired process references.

Coordinate with BI-BBA388A1 and BI-BD81682A rather than duplicating their remediation.

### Phase 7 — Repair shared reporting composition (BI-F7792FC1)

Move the three current regressions onto report-kit/shared primitives and retighten the baseline. Verify semantic table structure, keyboard access, responsive behavior, and theme-aware tokens against the running portal.

### Phase 8 — Prove system quality attributes (BI-1F3E083E)

Create an ATAM-aligned utility tree and executable scenarios for upgrade/rollback, restore, queue saturation/recovery, concurrent work, provider loss, optional-capability failure, and representative API latency/throughput. Reuse the governed local-CI lease, self-upgrade, telemetry, and benchmark substrate.

Coordinate with BI-PSC-004, BI-PSC-005, BI-PSC-008, and BI-PSC-009. Fast capability probes run per PR; resource-heavy scenarios run on a scheduled cadence. An empty or skipped scenario set fails closed.

### Phase 9 — Complete existing UI/runtime convergence dependencies

- BI-F2278856 — AI Workforce route consolidation
- BI-1D718FCA — progressive disclosure for high-overload routes
- BI-BBA388A1 — shared loading primitives
- BI-BD81682A — route-budget and accessibility-structure ratchet
- BI-PSC-004 / BI-PSC-005 — durable execution abstraction and benchmark
- BI-PSC-008 / BI-PSC-009 — operational truth and provider contracts
- BI-ECO-004 / BI-ECO-005 — event/receipt bus and shared company primitives

These items retain their owning epics. The hardening umbrella closes only when their architecture-relevant acceptance criteria have durable evidence or a newer governed decision supersedes them.

## Backlog coverage

Decision: `decomposed`

Receipt: `cmsaidchj02z601qk8qaedqsw`

Parent: BI-C04CAD7F

Plan path: `docs/superpowers/plans/2026-08-01-whole-platform-architecture-hardening.md`

| Deliverable | BI | Depends on |
|---|---|---|
| Application dependency DAG | BI-2E9F6D37 | — |
| ActorContext/application services | BI-963F4226 | BI-2E9F6D37, BI-BD43D871 |
| Finance canary | BI-58810028 | BI-2E9F6D37, BI-963F4226, BI-BD43D871 |
| API/action decoupling rollout | BI-71345FF0 | BI-58810028 |
| High-coupling cluster refactor | BI-B970B01D | BI-2E9F6D37, BI-PSC-004, BI-ECO-004, BI-ECO-005 |
| Generated architecture inventory | BI-FDA5DC4C | PR #3871 |
| Data conformance burn-down | BI-5881E707 | BI-PSC-006 |
| Owned debt budgets | BI-7B803E60 | BI-2E9F6D37, BI-BBA388A1, BI-BD81682A |
| Reporting composition repair | BI-F7792FC1 | — |
| Architecture fitness suite | BI-1F3E083E | BI-PSC-004, BI-PSC-005, BI-PSC-008, BI-PSC-009 |
| Durable execution contract | BI-PSC-004 | — |
| PostgreSQL runner benchmark | BI-PSC-005 | BI-PSC-004 |
| Prisma schema ownership | BI-PSC-006 | — |
| Operational truth/observability | BI-PSC-008 | — |
| Provider contracts | BI-PSC-009 | — |
| Integration event/action/receipt bus | BI-ECO-004 | — |
| Shared company primitives | BI-ECO-005 | — |
| Principal-first auth session | BI-BD43D871 | — |
| AI Workforce route consolidation | BI-F2278856 | — |
| Progressive disclosure | BI-1D718FCA | BI-BD81682A |
| Shared loading primitives | BI-BBA388A1 | — |
| UX route/structure ratchet | BI-BD81682A | — |

Revalidate with `check_plan_backlog_coverage` before each implementation BI starts or when this plan is resumed.

## Program completion gate

- Every mapped BI is done with accepted evidence, or explicitly superseded by a recorded governed decision.
- All new code lands through DCO-signed concern-sized PRs and passes local merged-code CI before push.
- Runtime-bound behavior has canonical-runtime/local-CI evidence; UI changes include exercised UX evidence; migrations include apply evidence.
- Architecture metrics show before/after coupling, transport dependencies, conformance counts, debt budgets, route/accessibility state, and fitness-scenario results.
- Documentation impact is resolved for architecture, operations, contributor, user, and coworker surfaces.
- Remaining risks have owners and dates; no indefinite unowned exceptions remain.

## Program risks

- **Freeze without convergence:** a baseline can legitimize debt. Mitigation: every exception is shrink-only and Phase 6 adds owners/targets/expiry.
- **Boundary fiction:** folders may not match business contexts. Mitigation: Phase 1 starts with measured application clusters and Phase 3 refactors semantics incrementally.
- **Authorization regression:** adapter extraction can widen access. Mitigation: characterization plus bearer/session parity and deny-by-default tests precede rollout.
- **Index overcorrection:** mechanically indexing every FK can harm writes/storage. Mitigation: query/relation evidence and representative plans are mandatory.
- **Harness theater:** fitness scenarios can report green without executing. Mitigation: capability probes and minimum-scenario assertions fail closed.
- **Program sprawl:** cross-cutting work can collapse into one unreviewable branch. Mitigation: one BI, branch, and PR per independently shippable concern.
