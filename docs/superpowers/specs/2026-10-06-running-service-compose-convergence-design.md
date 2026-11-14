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

### 1. One activation table for the compose chain (OBJ-CHAIN)

The chain has two parts:
- **Install-time choices:** dev or release mode, platform overlay, and edge. These cannot be re-derived later (`DPF_INCLUDE_EDGE` is not persisted), so they stay recorded in `install-state.json` and `DPF_SELF_UPGRADE_COMPOSE_FILES`.
- **Activation overlays:** switched on later by `.env` markers. This half drifted.

`scripts/installer/lib/activation-overlays.txt` is the single table of `MARKER overlay-file...`:
- `DPF_ORGANIZATION_TRUST_ENABLED` adds `docker-compose.organization-trust.yml` and `docker-compose.tls.yml`;
- `DPF_EDGE_ACTION_DISPATCH_CONFIGURED` adds `docker-compose.edge-actions.yml`.

Readers:
- **`compose.sh`** (Linux/macOS install, start and stop) reads it instead of hard-coding the markers.
- **`promote.sh`** appends the overlays whose marker is `1`, in the promoter's environment or the install env file, to the recorded chain. It reads the table from the target tree (`$_compose_root`), not from the promoter's own directory. That keeps the change outside the N-1 portal's staged promoter closure (BI-A04D61B9): an older target without the table changes nothing. Release assets ship the table beside `compose-chain.ps1`.
- **`compose-chain.ps1`** (Windows) keeps its own branches; a parity test fails when any marker adds different overlays there than in the table. It is not rewritten to read the table yet, because the change could not be exercised without PowerShell.

The promoter logs `step=compose-activation-overlays files=…` when it appends an overlay.

### 2. Per-service recreate class (OBJ-STATEFUL)

Each service declares its class on itself, as a compose label in the file that defines it:

```yaml
labels:
  dpf.recreate-class: stateless   # or data-owner, managed
```

The promoter reads the label from the rendered config it already produces (`docker compose config --format json`). Amended 2026-10-06 by WWMD `DI-3A94F2D28550` (high confidence, margin 2.65), replacing this spec's first proposal of a catalog field. The capability catalog models only capability-projected services in the base, macOS and Linux files. Activation-overlay services such as `portal-tls`, `step-ca` and the edge nodes are switched on by `.env` markers and would have needed a second kind of catalog entry or a parallel registry.

- **`stateless`:** recreate whenever the config hash differs. Covers `portal-tls`, the exporters, `alloy`, `grafana`, `prometheus`, `loki` (its data is a volume, and recreate does not touch volumes), `inngest`, `adp`, `browser-use`, `dpf-tts`, `ollama` and the edge services.
- **`data-owner`:** `postgres`, `sandbox-postgres`, `dev-postgres`, `redis` and `step-ca` (the certificate authority's keys). These recreate only when their config hash differs, and only in step 3c (below).
- **`managed`:** `portal`, `sandbox`, the one-shot init jobs, the promoter, and the dev, test and local-CI portals. Each keeps its own lifecycle; convergence leaves them alone.

`scripts/check-no-unclassified-compose-services.mjs` (run by the repo guard loop) fails when any service in any shipped `docker-compose*.yml` has no class, an unknown class, or two files that disagree.

**One-time effect.** Adding the label changes every service's compose config hash. The first upgrade that runs steps 3c and 7e therefore recreates each service once, including one `postgres` restart in step 3c, behind the recovery point. Later upgrades recreate only what changed.

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

## Image identity follow-up (D6, BI-0282088D)

Source assessment: November 13, 2026, at `f2a0b7dff478f89f9bcf8dda7f25b93eac3634e0`.
This extends the design; it does not turn on step 7e or change data-owner policy.
D1, D2 and the shadow D3 are delivered. D4 (BI-7F2709F9) and D5
(BI-205A85C0) remain separate unfinished work. Finishing D6 does not establish
the umbrella's original AC-1 through AC-5.

The signed capability actuator already checks its packaged protocol, pins the
portal writer image, journals state, compensates failures and checks service
health. Its final `up -d --wait` does not establish an intended code image for
build-only services. In source mode, `browser-use` has a local build context;
the release overlay instead selects a published image. Healthy services,
ACTIVE settings, equal config hashes and the portal SHA are insufficient image
evidence. This finding does not diagnose a particular stale container or the
earlier preview failures.

Docker's [build contract](https://docs.docker.com/reference/cli/docker/compose/build/)
requires rebuilding changed build inputs. Its [up contract](https://docs.docker.com/reference/cli/docker/compose/up/)
recreates services when their image or configuration changes. These are separate
steps; neither replaces DPF's authorization, recovery or image identity checks.

**OBJ-IMAGE:** Native reconciliation runs selected stateless services on their
qualified intended image bytes, or holds before runtime mutation with a useful
reason. It never treats a green capability state as image proof.

### Decision and authority

WWMD DI-CAC49D437EA8 chose `native-image-plan` with high confidence and
`autonomyEligible: true` for design. Alternatives were promoter-wide enforcement
after shadow evidence, and published images for all install modes. The selected
path extends the existing signed reconciliation protocol and receipt. No new
table, MCP tool, agent, alternate runtime or client integration is needed.

This decision grants no production build, restart, funding, permission or
stateful-policy authority. The existing item funding attribution is pending
cmwfngfl80hwh0eqchdgot70a; do not infer that it executed. Production remains with
the existing coordinator and normal runtime action gates.

### Intended source and image plan

The server derives the selected services and expected image identity from its
trusted canonical source or immutable release evidence. The caller supplies no
host paths, replacement hashes, arbitrary Docker arguments or image overrides.
The signed plan binds the source, catalog/state version, selected services,
before images, intended inputs, preparation limits and protocol identity.

Reuse the existing canonical artifact-preparation path. A source install must
stage the exact immutable source's bounded build inputs, not a moving host
checkout. Git object content or a qualified canonical build context may supply
those bytes; a SHA label alone cannot. Unsupported remote, escaping, missing or
unqualified contexts hold before runtime changes. Consumer installs use their
existing qualified published image digests. Do not force source builds onto
consumer installs or change service activation to obtain an image.

Preparation names only the selected stateless services. It must not add
`--build` to the current full required-service list. Record actual image IDs and
available build-input/provenance evidence, pin the qualified output for apply,
then compare the running containers' image IDs and existing health semantics.
An unknown dependency, source, image or health result stays unverified.

For the first bounded implementation, image reconciliation does not also change
capability activation. Require identical before/after capability keys and states,
an unchanged issued preview, and selected services already running and classified
stateless in the canonical chain. A different activation request uses its existing
separate transition. This keeps image repair from acquiring wider startup rights.

Apply and compensation name only those selected services, with dependency startup
and implicit builds disabled. Do not send the image operation through the legacy
full required-service `up`. Check the full required-service health projection
afterward and verify that unselected managed/data-owner container identities stayed
unchanged. A missing container, changed ownership or unexpected dependency holds
before effects. Reuse the signed reconciliation mode with negotiated image-plan
support; this does not require an alternate action engine.

### Recovery and compatibility

Before any runtime effect, persist the exact prior image IDs and selected plan
in the existing signed journal/receipt flow. Replay resumes that plan; it does
not silently resolve a newer mutable tag or rebuild a different source.
Compensation restores the prior qualified images and prior capability state.
An unavailable prior image, changed ownership or uncertain child settlement
retains a failed or unverified recovery result.

Use the existing packaged protocol probe to negotiate image-plan support.
Older or unsupported actuators must refuse before host effects. Do not add a
trusted import or a candidate `COPY` requirement that the deployed N-1 minimal
promoter context cannot supply. Extend the identity-bound closure only through negotiated support; missing optional
image dependencies must leave ordinary v1/v2 staging loadable and refuse v3 before
host effects.
Do not manufacture protocol support from a portal revision.

Managed services and data owners keep their existing lifecycles. Stopped
services stay stopped unless a separate existing activation decision authorizes
them. Volumes, recovery points, scope-writer qualification, grant intersection,
runtime transition ownership and health checks retain their authority. Root's
separate browser security-policy work is not authorized by this image plan.

### D6 acceptance

| ID | Objectives | Statement |
|---|---|---|
| AC-I1 | OBJ-IMAGE | Desired service images are server-derived from immutable canonical source/release evidence; labels or portal SHA alone never qualify them. |
| AC-I2 | OBJ-IMAGE | A selected build-only stateless service has bounded native preparation with exact input/image proof and no implicit build of unrelated required services. Missing or unsupported proof holds before runtime mutation. |
| AC-I3 | OBJ-IMAGE | Actual post-apply image IDs and existing health checks must match the signed plan before applied is recorded. |
| AC-I4 | OBJ-IMAGE | Crash replay and compensation preserve/recover the exact prior qualified image IDs; uncertain ownership or settlement remains unverified. |
| AC-I5 | OBJ-IMAGE | No stateful/managed restart, stopped-service activation, volume removal, grant/policy expansion or shadow-mode enforcement is introduced by this slice. |
| AC-I6 | OBJ-IMAGE | Source/consumer and platform differences use existing runtime contracts. Old or unsupported packaged protocols fail closed before host effects, including N-1 promoter staging. |
| AC-I7 | OBJ-IMAGE | Affected production-owner tests, normal gates/independent review, governed served workflow/failure recovery and exact cleanup supply separate truthful evidence; no fixture is production acceptance. |

The child has accepted research `initiative-79ab62cd-2245-4d5b-919f-7eea0cc8f483`,
its own immutable coverage `cmwfow6zm0sqe0eqcd4nshyae`, and implementation admission
`IRD-D2A0E98FB7C3`. These admit source work; they are not runtime acceptance.

### Bounded v3 implementation

The existing administrator reconciliation tool accepts only the optional
`imageServices: ["browser-use"]` selection. The executor derives the plan from
its verified packaged source SHA, host platform and installed release carrier.
Source mode archives the immutable `services/browser-use` Git tree to Docker
stdin. These read-only Git calls use command-scoped `safe.directory=/host-source`
for the fixed mount because the runtime-transition branch precedes the updater’s
ordinary Git setup. No global Git configuration is changed. This follows
[Git’s protected safe-directory contract](https://git-scm.com/docs/git-config#Documentation/git-config.txt-safedirectory).
Consumer mode resolves the installed immutable release through the existing
manifest reader, then pulls only its pinned digest. Actual image ID, platform,
source revision and source input-tree or published digest evidence must agree.

Version 3 authenticates the plan, receipt and recovery proof recursively. The
read-only packaged probe explicitly advertises support and binds the actuator,
signer and the combined bytes of the existing `promoter-epoch-evidence.mjs`
artifact owner and shared `lib/git.mjs` reader. The artifact owner is already in
the N-1 minimum promoter context. The Git reader loads only after v3 qualification;
when an older minimum staging omits it, the probe retains v1/v2 apply and reports
no image support. No candidate COPY dependency is added to that older closure.
New full promoter images already copy the scripts directory. Version 1 and 2
behavior stays intact.

Before preparation, the actuator observes the running project and saves a private
resolved Compose baseline. The installed Compose implementation must reproduce
the selected container's configuration hash using the original or actual image
reference. A mismatch holds; it does not enable shadow enforcement. This avoids
reimplementing Docker's hash algorithm or treating image-only authority as consent
to apply other configuration. Selected services use existing volumes and networks
as external resources, with dependency startup, builds and pulls disabled at apply.
Unselected container IDs and selected resource identities must remain unchanged.

The signed journal records prior IDs, immutable preparation and each apply phase.
A completed receipt includes exact intended/observed images, health and resource
hashes. An interrupted preparation or child apply is `rollback_failed` with a
durable recovery barrier; another attempt cannot erase that uncertainty. Native
unhealthy apply restores the exact prior cached image. Database compensation
requires the authenticated original applied receipt and a signed restore-only
plan. Identical capability settings alone never prove that image effects were absent.
Selected image owners retain their existing catalog and saved manifest work guards.
The ordinary serializable receipt admission rechecks attributed tasks even though
image-only reconciliation disables no capability; active work returns drain-required
before a transition row or service apply is created.
The producer half serializes inside the transaction that creates a TaskRun or
build. Real PostgreSQL contention showed that an advisory-lock SELECT can fix a
Serializable snapshot before the wait ends, hiding a newly committed transition.
The shared admission helper therefore first takes a `SHARE ROW EXCLUSIVE` lock
on the existing transition table, then the existing advisory lock. PostgreSQL's
[utility snapshot rule](https://raw.githubusercontent.com/postgres/postgres/REL_17_STABLE/src/backend/tcop/pquery.c)
explicitly excludes `LOCK` and `SHOW`, so serialization precedes snapshot
creation. `createPending` and `commitSuccess` use the same order. No host work
or inference runs under these metadata locks; transaction timeout settings are
not changed. The drain counter uses the existing transaction-bound attribution
store, avoiding an outer-pool request behind producers waiting on these locks.
It examines every active transition and the existing
`rollback_failed`/`recoveryRequired` image barrier, so unchanged capability keys
cannot admit new matching work after the initial drain. The persisted v3 plan
uses the shared validator; selected catalog owners and their saved manifests
supply the guard union. Malformed image metadata retains only the existing
browser recipe's guards, rather than silently losing its scope or stopping
unrelated producers. Settled recovery releases the image guard. Legacy active
key-removal admission retains its previous behavior.

All eight actual production admission sites and their outer transaction wrappers
are inventoried in the existing plan. Autonomous/build TaskRun admission already
comes first; coworker spawn and durable Workroom tasks now acquire the same
helper before parent/authority reads or a WorkCapsule row lock. Later admission
reuses only a successful fence on that exact transaction object, preserving
transactional ownership checks and existing-task replay. Capsule stores can
receive an already-open transaction; their wrappers must not be treated as a
snapshot reset. Current late-read Build/Capsule wrappers use ReadCommitted.

The helper verifies actual isolation for every guard. In fixed-snapshot modes,
SHOW and same-value `SET TRANSACTION [NOT] DEFERRABLE` preserve existing settings
and assert that no first snapshot exists. PostgreSQL's
[deferrable check](https://raw.githubusercontent.com/postgres/postgres/REL_17_STABLE/src/backend/commands/variable.c)
rejects a prior snapshot even on the same value; its isolation check explicitly
permits same-value SET and is unsuitable. An unsupported late fixed-snapshot
caller fails before capabilities or transitions are read, rather than silently
admitting stale state. No isolation downgrade, new persistent epoch, durable
authority, grant, or transaction timeout change is introduced. Actual Prisma/
PostgreSQL coverage must prove the utility ordering and real caller behavior.
The existing ten-minute authority lifetime is preserved. Preparation reserves time
for bounded apply and restoration; a short remaining lifetime holds before effects.

Source tests use injected process adapters and isolated temporary files. Their
passing results do not establish served owner acceptance. Exact-tree gate,
independent review, protected delivery and governed runtime verification remain
required before D6 is complete.
