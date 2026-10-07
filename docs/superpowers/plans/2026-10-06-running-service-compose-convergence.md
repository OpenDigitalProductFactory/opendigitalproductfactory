---
status: active
---

# Plan: self-upgrade converges running services to the shipped compose config

- Backlog item: BI-C54E691E
- Spec: [2026-10-06-running-service-compose-convergence-design.md](../specs/2026-10-06-running-service-compose-convergence-design.md)
- Decision: DI-C0BF4CF3A173
- Date: 2026-10-06

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Acceptance (BI-C54E691E)

- AC-1 (OBJ-CHAIN): On an install whose TLS overlays came from bootstrap-organization-pki, the promoter's chain includes organization-trust.yml and tls.yml, from the same resolver the start path uses.
- AC-2 (OBJ-CONVERGE): A self-upgrade that changes portal-tls's compose config recreates it. Live: Init=true, and service-converge-outcome.json lists it as recreated.
- AC-3 (OBJ-STATEFUL): An unchanged postgres keeps its container id through a self-upgrade. A changed one is recreated before the portal swap. A failed health check aborts before the swap.
- AC-4 (OBJ-CONVERGE): A stopped service stays stopped, and an inspection failure never recreates a container.
- AC-5 (OBJ-HONEST-GATE): The convergence gate refuses `auto-converges` for a service no resolved chain contains. Every shipped compose service has a catalog recreateClass.

## Traceability

| Deliverable | Objectives | Contracts | Flow | Acceptance |
|---|---|---|---|---|
| D1 compose-chain resolver | OBJ-CHAIN | `resolveComposeChain`, `scripts/lib/compose-chain.mjs`, `compose.sh`, `release-target.ts`, `bootstrap-organization-pki.sh` | install, start and self-upgrade render one chain | AC-1 |
| D2 catalog recreate class | OBJ-STATEFUL, OBJ-HONEST-GATE | `recreateClass`, `capability-service-catalog.generated.json`, `dpf.recreate-class` | catalog generation and contract test | AC-5 |
| D3 sidecar converge (step 7e) | OBJ-CONVERGE | `promote.sh` step 7e, `service-converge-outcome.json` | self-upgrade step 7e sidecar-converge | AC-2, AC-4 |
| D4 data-owner converge (step 3c) | OBJ-STATEFUL | `promote.sh` step 3c | self-upgrade step 3c data-owner-converge | AC-3 |
| D5 checkable convergence gate | OBJ-HONEST-GATE | `convergence-surfaces.json`, `check-convergence-impact` | PR convergence gate | AC-5 |

## D1 (BI-B422ED03): one compose-chain resolver (AC-1)

- **Change:**
  - Add `scripts/lib/compose-chain.mjs` with `resolveComposeChain({ installState, env, platform })`, carrying the rule now in `scripts/installer/lib/compose.sh:95-120`: the base file, the platform overlay, the release overlay, `edge.yml`, `organization-trust.yml` plus `tls.yml`, and `edge-actions.yml`.
  - `compose.sh` calls it.
  - `release-target.ts` and `promote.sh` (`_f_args`) use the derived chain. `DPF_SELF_UPGRADE_COMPOSE_FILES` becomes an override, logged when it differs.
  - `bootstrap-organization-pki.{sh,ps1}` uses the resolver instead of its own chain.
  - `compose-chain.ps1` gets fixture parity with the resolver.
- **Tests first:** a fixture install with the `DPF_ORGANIZATION_TRUST_ENABLED=1` marker and a frozen `composeFiles` lacking TLS. The resolver returns the TLS overlays, and so do the promoter's `_f_args` (shell harness).
- **Ships alone:** yes. It makes `portal-tls` visible to step 7d and the gate even before D3.

## D2 (BI-22A2CA0D): per-service recreate class (AC-5, part)

- **Change (amended by WWMD `DI-3A94F2D28550`):** every service declares `labels: dpf.recreate-class: stateless|data-owner|managed` in the compose file that defines it, overlay services included. The shared compose parser in `check-capability-compose-profiles.mjs` learns labels and block-list profiles. A new guard, `scripts/check-no-unclassified-compose-services.mjs`, fails on a service with a missing, unknown or conflicting class.
- **Tests first:** the guard's own tests, plus the guard run on main, which reports 31 unclassified services.
- **Ships alone:** yes. The labels are metadata: nothing reads them until D3 and D4. Portal and sandbox pick them up on their existing force-recreate.
- **Note for D3/D4:** adding the labels changes every service's config hash, so the first upgrade with D3/D4 recreates each service once, including one postgres restart in step 3c.

## D3 (BI-00F7D2E3): step 7e sidecar-converge (AC-2, AC-4) — depends on D1, D2

- **Shipped first in shadow mode** (WWMD `DI-C04ABC76BBF4`).
  - After 7d, the step compares each running service's `com.docker.compose.config-hash` label with `docker compose config --hash` rendered with 7d's daemon-path override.
  - It records `wouldRecreate`, `unchanged`, `skippedStopped`, `dataOwnerChanged`, `unclassified` and `failed` in `service-converge-outcome.json`.
  - It recreates nothing and never fails the run. It also runs under `--dry-run`.
- **Why shadow:** on 2026-10-06 a host render of the live chain matched `portal-tls` and `postgres` but differed for `portal`, `loki`, `alloy`, `inngest` and `redis`, none of which had an intended change. Enforcing at once risked recreating those every upgrade. The shadow report from one live upgrade decides whether the promoter's render is stable.
- **Then enforce:** a follow-up makes stateless `wouldRecreate` entries run `up -d --no-deps <svc>` with the same arguments, with health checks, stopped services left stopped, and fail-loud-not-abort.
- **Tests first:** `scripts/promote-sidecar-converge.test.mjs`. A fake `docker` serves the rendered config, the hashes and the container list. The test proves the outcome classification and that no `up`, `rm` or `--force-recreate` call is made.

## D4 (BI-7F2709F9): step 3c data-owner-converge (AC-3) — depends on D2

- **Change:**
  - After 3a and before 3b and the swap, for each running `data-owner` whose hash differs, recreate it and wait for health.
  - A failure aborts the promotion before the swap, and the recovery point restores the install.
  - Fold `_recreate_pg_onto_pgvector` into this step.
- **Tests first:** the harness checks that `postgres` keeps the same container id when unchanged, is recreated before the portal swap when changed, and aborts before the swap on a failed health check.

## D5 (BI-205A85C0): checkable convergence gate (AC-5) — depends on D1, D2

- **Change:** the `compose` surface checks the services a PR changes. `auto-converges` is valid only when each changed service is in a resolvable chain and has a `recreateClass`. Otherwise the gate refuses with the reason.
- **Tests first:** the fixtures include #6020's shape, a `portal-tls` change before D1/D2. It is refused before and accepted after.

## Risks and rollback

- **Recreating a stateful service mid-upgrade:** D4 confines it to a changed hash, before the swap and behind the recovery point. Unchanged data-owners are never touched (AC-3).
- **Over-eager recreation from a non-deterministic render:** the hash comes from compose itself. Proven live: `config --hash portal-tls` equals the container label.
- **Rollback:** each deliverable is its own PR and reverts cleanly. D3 and D4 only add steps; reverting restores today's behaviour.

## Backlog coverage

Decomposed. Umbrella BI-C54E691E.

| Deliverable | Backlog item | Depends on |
|---|---|---|
| D1 | BI-B422ED03 | — |
| D2 | BI-22A2CA0D | — |
| D3 | BI-00F7D2E3 | D1, D2 |
| D4 | BI-7F2709F9 | D2 |
| D5 | BI-205A85C0 | D1, D2 |
