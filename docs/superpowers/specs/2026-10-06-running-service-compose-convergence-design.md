---
status: active
---

# Self-upgrade converges running services to the shipped compose config

- Backlog item: BI-C54E691E
- Decision: DI-C0BF4CF3A173 (WWMD, high confidence: converge every changed service, with a declared policy for stateful ones)
- Related: BI-95BB9CB1 / #6020 (zombie reaping), BI-D011EBE2 (missing services never start), [upgrade service recovery](2026-10-02-upgrade-service-recovery.md), [convergence-impact gate](2026-09-06-convergence-impact-gate-design.md)
- Date: 2026-10-06

## Problem

A change to a running service's compose config reaches an existing install only when the promoter happens to force-recreate that service. Today that means `portal`, `inngest` (key alignment) and `sandbox`. For every other service, including `postgres`, `redis`, the observability sidecars and `portal-tls`, the change ships in the release and never runs.

Live, 2026-10-06:
- #6020 gave `portal-tls` a reaping `init` and a PID cap. Its container stayed on the 2026-09-18 config with 11,844 zombie `ssl_client` processes until an operator recreated it by hand.
- The PR attested `Convergence-Impact-Decision: auto-converges`. The gate could not tell that no mechanism reached the service.

Two defects compound:
1. **The promoter's compose chain is frozen at install.** `install-dpf.sh` records `composeFiles` and `DPF_SELF_UPGRADE_COMPOSE_FILES` once. `bootstrap-organization-pki.sh` later enables the TLS overlays by writing `.env` markers only. The start path re-derives the chain from those markers (`scripts/installer/lib/compose.sh:103-120`), but the promoter reads the frozen list. So `portal-tls` is not even in the promoter's view.
2. **Step 7d only creates missing services.** A running service whose rendered config hash differs from its `com.docker.compose.config-hash` label is left as it is.

## Objectives

- **OBJ-CHAIN:** The promoter renders the same compose chain the install starts with, derived by one function from install state and the activation markers, never from a list frozen at install time.
- **OBJ-CONVERGE:** After a self-upgrade, every running service in that chain whose rendered config differs from its container's config has been recreated onto the new config, or is reported as not converged with the reason.
- **OBJ-STATEFUL:** A service that owns data converges only inside the upgrade's quiescence window, behind the recovery point, health-gated, and before the portal swap. It is never restarted for a service whose config did not change.
- **OBJ-HONEST-GATE:** A compose change attested `auto-converges` is true by construction, because the converging step covers every service in the chain.

## Research & Benchmarking

| System | How a config change reaches a running service | What DPF takes |
|---|---|---|
| Docker Compose | `up -d` compares each service's rendered config hash with the container's `com.docker.compose.config-hash` label and recreates only the services that differ. | The mechanism itself. DPF already runs compose; it just never asks it to converge the services it doesn't name. |
| Kubernetes | Deployments roll when the pod-template hash changes. StatefulSets roll on the same signal, but in ordinal order, with `partition` for staged rollout. | Treat a stateless and a stateful change differently on the same trigger (config hash), not with two different triggers. |
| Kamal (37signals) | App containers redeploy. "Accessories" (database, cache) are deliberately not rebooted on deploy; an operator runs `kamal accessory reboot`. | Rejected: this is exactly the drift DPF hit. It breaks [upgrade the fleet forward-only](../../professions/devops-platform/wiki/upgrade-the-fleet-forward-only.md), where no operator is present. |

Standard: declarative convergence to versioned desired state (infrastructure as code). DPF's deviation is narrow: data-owning services converge in a fixed position in the upgrade (before the swap, behind the recovery point), not whenever compose would.

## Design

### 1. One compose-chain resolver (OBJ-CHAIN)

Add `scripts/lib/compose-chain.mjs`: `resolveComposeChain({ installState, env, platform }) → string[]`. It owns the rule that `compose.sh:103-120` holds today:
- the base file;
- the platform overlay;
- the release overlay when release-built;
- `docker-compose.organization-trust.yml` and `docker-compose.tls.yml` when `DPF_ORGANIZATION_TRUST_ENABLED=1`;
- `docker-compose.edge-actions.yml` when `DPF_EDGE_ACTION_DISPATCH_CONFIGURED=1`;
- and any further activation overlay registered there.

These callers use it instead of their own lists:
- `compose.sh` (via `node`);
- `release-target.ts`;
- `promote.sh` (when it builds `_f_args`);
- `bootstrap-organization-pki.{sh,ps1}`.

`install-state.json.composeFiles` becomes the derived output of the resolver, refreshed on every install, start or upgrade, not a second source. `DPF_SELF_UPGRADE_COMPOSE_FILES` stays only as an explicit operator override and is logged when it differs from the derived chain. The PowerShell installer (`compose-chain.ps1`) is aligned to the same rule, through a parity test against fixtures, because it cannot call `node` before Node is provisioned.

### 2. Per-service recreate class (OBJ-STATEFUL)

Add `recreateClass` to every service in `scripts/capability-service-catalog.generated.json`, generated from the catalog source:
- **`stateless`:** recreate whenever the config hash differs. Covers `portal-tls`, the exporters, `alloy`, `grafana`, `prometheus`, `loki` (its data is a volume, and recreate does not touch volumes), `step-ca`, `inngest`, and the edge services.
- **`data-owner`:** `postgres` and `redis`, plus any service whose `canonicalDataOwner` is itself and whose `backupPolicy` is `included` or `separate-required`. These recreate only when their config hash differs, and only in step 3c (below).
- **`managed`:** `portal` and `sandbox`, which keep their existing dedicated steps.

`portal-tls`, `step-ca` and the edge services are added to the catalog. A contract test fails when a service in any shipped compose file has no catalog entry and class. That also closes the gap that let `portal-tls` go uncatalogued.

### 3. Convergence steps in `promote.sh` (OBJ-CONVERGE, OBJ-STATEFUL)

- **Step 3c, data-owner-converge** (new). It runs after `3a ensure-pgvector`, before `3b migrate` and before the portal swap, inside the quiescence window and behind the recovery point. For each running `data-owner` service whose rendered hash (`docker compose config --hash <svc>`) differs from its container label:
  - recreate it with `up -d --no-deps <svc>`;
  - wait for its health check.

  A failure aborts the promotion before the swap, exactly as a failed 3a does today, and the recovery point restores the install. `_recreate_pg_onto_pgvector` becomes the first instance of this step rather than a special case.
- **Step 7e, sidecar-converge** (new). It runs after 7d. For each running `stateless` service whose hash differs:
  - run `up -d --no-deps <svc>` (compose recreates only on a hash difference);
  - check health.

  A failure is fail-loud-not-abort, like 7b and 7d: the portal upgrade stands, the service is reported degraded, and the next upgrade retries.

Rules carried over from [upgrade service recovery](2026-10-02-upgrade-service-recovery.md):
- A service the operator stopped stays stopped; convergence considers only running containers.
- An inspection failure is never permission to recreate.
- An unknown container is never touched.

Outcome: `service-converge-outcome.json` lists `recreated`, `unchanged`, `skipped-stopped` and `failed`, each with the before and after hash. It is recorded on the run like `service-reconcile-outcome.json` and shown on `/ops/self-upgrade`.

### 4. The convergence gate becomes checkable (OBJ-HONEST-GATE)

The `compose` surface in `scripts/convergence-surfaces.json` gains a per-service check. When a PR changes a service that the resolved chain covers and that has a `recreateClass`, then `auto-converges` is valid and its mechanism is named (step 3c or 7e). When the service is outside every chain the resolver can produce, `auto-converges` is refused with that reason.

## Not in scope

- Removing services that are no longer shipped (BI-922EBB99).
- Starting services new to an install (BI-D011EBE2, step 7d).
- Volume or schema migration of a data-owner's contents. A data-owner recreate keeps its volumes; changing them stays a migration.

## Acceptance

| ID | Objectives | Statement |
|---|---|---|
| AC-1 | OBJ-CHAIN | On an install whose TLS overlays were enabled by `bootstrap-organization-pki`, the promoter renders a chain that includes `docker-compose.organization-trust.yml` and `docker-compose.tls.yml`, from the same resolver the start path uses. |
| AC-2 | OBJ-CONVERGE | A self-upgrade that changes `portal-tls`'s compose config recreates `portal-tls`. Live: `HostConfig.Init=true`, and `service-converge-outcome.json` lists it as recreated with both hashes. |
| AC-3 | OBJ-STATEFUL | A self-upgrade with no `postgres` config change leaves the `postgres` container untouched (same container id). With a change, it recreates `postgres` before the portal swap. A failed `postgres` health check aborts before the swap, and the recovery point restores the install. |
| AC-4 | OBJ-CONVERGE | A stopped service stays stopped, and an inspection failure never recreates a container (tests). |
| AC-5 | OBJ-HONEST-GATE | The convergence gate refuses `auto-converges` for a compose change to a service no resolved chain contains, and every service in a shipped compose file has a catalog `recreateClass` (contract test). |
