---
status: draft
backlogItem: BI-83260BB3
workroom: WC-36508ED3
---

# Monitoring as an operator choice — implementation plan

**Umbrella:** BI-83260BB3 / WC-36508ED3 (delivery-large), epic EP-MFG-DELIVER-INSTALL.
**Design:** [monitoring operator choice design](../specs/2026-10-13-monitoring-operator-choice-design.md) — objectives OBJ-MON-01..04, acceptance AC-MON-01..10.
**External dependency:** BI-5ACBAC50 (capability-state reconciliation, WC-0AD784CD, owned by another session). D5's switch is not admissible on a drifted install until it lands; D5 ships with the switch disabled-with-reason (AC-MON-06) if it lands first.

Coverage decision: **decomposed**. Each slice below is independently shippable and has its own live BI; the umbrella closes when all six are delivered and BI-5ACBAC50's integrity criteria hold.

## Slices

### D1 — Resource budgets (BI-D6769E2F)

1. Add `prometheus`, `grafana`, `postgres-exporter` to `config/install-resource-budgets.json` `optionalProfileServices` with profiles `runtime-deep-observability`, `observability-ui`.
2. Add matching `deploy.resources.limits` to the three services in `docker-compose.yml`.
3. Extend `scripts/check-compose-resource-budgets.test.mjs`: a profile-gated service with a budget entry must carry matching limits (red first).
4. Measure on the dev install with monitoring on (`docker stats --no-stream`, three samples 5 min apart); record evidence; adjust any bound above 70% steady state.

Verification: guard test; compose render (`node scripts/dpf-compose.mjs config`); measured stats.

### D2 — Decision record (BI-0048E94D)

1. Schema: optional `runtimeCapabilityDecisions` in `scripts/installer/install-state.v2.schema.json`; extend the schema test with valid/invalid fixtures.
2. Resolver migration in `scripts/lib/resolve-capability-compose-profiles.mjs`: missing map → `runtime:deep-observability` recorded `undecided`/`upgrade-carried`; `enabledRuntimeCapabilities` byte-identical.
3. `scripts/apply-runtime-capability-transition.mjs`: when desired vs previous keys toggle a capability, write `{decision, source: "portal", decidedAt}` into `next` before journaling, so journal `before`/`next` and the receipt cover it.
4. TS reader in `apps/web/lib/platform-runtime/operational-state.ts` exposes the decision map.

Verification: schema, resolver and apply-script unit tests (fail first); Installer State Contract guard.

### D3 — Installer question (BI-31F11C37) — depends on D1, D2

1. `install-dpf.ps1`: `-Monitoring On|Off` param and help text; prompt after the mode choice via `Read-DPFInstallerInput`; cost read from the budgets file; skip when a decision is already recorded; headless default.
2. `scripts/installer/lib/state.ps1`: write `enabledRuntimeCapabilities` and the decision in the same `Set-DpfStateValues` call before `Resolve-DpfCapabilityComposeProfiles`.
3. `install-dpf.sh`: `--monitoring on|off`, same prompt and headless behavior.
4. Tests: installer help contract, Pester/bats-style unit tests for the four branches (prompt yes/no, flag, headless, already-decided).

Verification: Installer Help Contract and State Contract guards; unit tests; fresh-install dry run in the shared local-CI sandbox.

### D4 — Honest off-state (BI-2CE9CBF4)

1. Server helper `getMonitoringAuthority()` returning `on | off` from operational capability state.
2. `/api/platform/metrics*`: return 200 `{status: "monitoring-off"}` when off; 503 only when on and unreachable.
3. `MonitoringContext`: `status: on | off | unreachable | checking`; provider seeded from the server value.
4. Update `PlatformHealthIndicator`, `PlatformHealthStrip`, `SystemHealthDashboard`, `ServiceHealthDashboard`, metric widgets, `LogIssuesPanel` Grafana links. Strings via the i18n catalog; theme tokens only.

Verification: component tests per state; route tests; UX-fit review; served-target check light/dark/mobile.

### D5 — Settings surface and switch (BI-8BBFE50B) — depends on D2, BI-5ACBAC50

1. Route `/admin/settings/monitoring` (server component) + link from `/admin/settings` and `/platform/ai/runtime-health`; route manifest/audience/shells/page-purpose regenerated.
2. State derivation `deriveMonitoringSwitchState(operationalState, decisions)` → On / Off / Turning on / Turning off / Needs attention / Unreconciled, unit-tested over a fixture matrix including drift.
3. Client action button calling `requestRuntimeCapabilityTransition` with a fresh `RCT-*` id; outcome → copy mapping for every coordinator result; latest receipt panel.
4. Setup step `monitoring` in `setup-constants.ts` + i18n label, shown only when the decision is `undecided`.
5. Read-only rendering without `manage_platform`.

Verification: unit tests for state derivation and outcome mapping; UX-fit review; runtime acceptance on the served dev install (on → containers + receipt + Grafana "Portal journeys" row; off → containers gone + AC-MON-07 copy).

### D6 — Documentation (BI-B670E078)

Correct `docs/architecture/platform-overview.md` Monitoring Stack Topology and `docs/architecture/capability-driven-runtime-profiles.md` profile table. Docs lint only.

## Sequencing

D1, D2, D4, D6 can start in parallel. D3 after D1+D2. D5 after D2; its live switch also needs BI-5ACBAC50.

## Traceability

| Deliverable | Backlog item | Requirements | Contracts | Flows | Verification |
| --- | --- | --- | --- | --- | --- |
| D1 | BI-D6769E2F | AC-MON-08 | `config/install-resource-budgets.json`; `docker-compose.yml` | install/upgrade compose up with monitoring on | `scripts/check-compose-resource-budgets.test.mjs`; measured docker stats |
| D2 | BI-0048E94D | AC-MON-09; AC-MON-05 | `scripts/installer/install-state.v2.schema.json`; `scripts/apply-runtime-capability-transition.mjs` | upgrade migration; host transition apply journal | schema, resolver and apply-script tests |
| D3 | BI-31F11C37 | AC-MON-01; AC-MON-02 | `install-dpf.ps1`; `install-dpf.sh`; `scripts/installer/lib/state.ps1` | interactive, flag and headless install | installer unit tests; help/state contract guards |
| D4 | BI-2CE9CBF4 | AC-MON-07 | `apps/web/components/monitoring/MonitoringContext.tsx`; `apps/web/app/api/platform/metrics/route.ts` | header and dashboard render with monitoring off | component and route tests; served-target check |
| D5 | BI-8BBFE50B | AC-MON-03; AC-MON-04; AC-MON-05; AC-MON-06 | `apps/web/lib/actions/runtime-capabilities.ts`; `/admin/settings/monitoring` | onboarding step → settings → transition → receipt | state-derivation tests; live on/off acceptance |
| D6 | BI-B670E078 | AC-MON-10 | `docs/architecture/platform-overview.md`; `docs/architecture/capability-driven-runtime-profiles.md` | operator reads architecture docs | docs lint |
