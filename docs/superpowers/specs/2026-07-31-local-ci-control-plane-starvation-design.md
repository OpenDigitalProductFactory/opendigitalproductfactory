# Local-CI Control-Plane Starvation Prevention

- **Status:** accepted for implementation
- **Date:** 2026-07-31
- **Backlog item:** `BI-CE6E2882`
- **Epic:** `EP-0DFF753B`
- **Work Capsule:** `WC-BD87F076`
- **WWMD decision:** `DI-EBA2C9239C5C`

## Decision

Keep the canonical Docker production artifact, but run its build in a slot-scoped
`docker-container` BuildKit builder with explicit CPU, memory, and BuildKit
parallelism ceilings. While the build runs, independently probe the installed
portal, MCP endpoint, Docker Engine, and PostgreSQL over its host port. A sustained
control-plane breach terminates the build, records a distinct
`blocked_control_plane_starvation` infrastructure outcome tied to branch, SHA, and
slot, and prevents capacity expansion.

The gate does not restart Docker Desktop, the portal, or PostgreSQL. A shared-service
restart remains an intentional governed recovery action. A TCP listener without a
valid application response is unhealthy.

## Incident boundary

The evidence establishes two separate events:

1. Lease `NPEL-E5F0F81B36` ran an unconstrained daemon-side `docker build`. The
   production build compiled, reached TypeScript, then stopped progressing while
   portal HTTP/MCP, Docker Engine API, and independent PostgreSQL access became
   unavailable.
2. Later, a separate process explicitly called Docker Desktop `/app/quit`. That was
   not the initiating build pressure and must not be represented as natural or
   automatic recovery; the restart extended the outage while the engine bridge
   failed to return.

Prevention and evidence address the first event. Governed recovery semantics address
the second. The implementation must not conflate them.

## Existing substrate to extend

| Concern | Source of truth | Extension |
| --- | --- | --- |
| Slot identity | `local-ci-slot-resources.json`, `local-ci-slot-manifest.mjs` | Add deterministic builder identity and resource policy |
| Build orchestration | `local-integration-ci.mjs` | Replace plain Windows `docker build` with the bounded wrapper |
| Gate evidence | `gate-worktree.mjs`, `local-integration.ts` | Add control-plane samples and reserved status |
| Infrastructure classification | `sandbox-freshness.mjs`, MCP evidence pack | Map a reserved exit code without charging product failure |
| Capacity rollback | `local-ci-pool-circuit-breaker.ts`, pilot report | Treat any starvation signal as binding rollback evidence |

No new table, scheduler, lease type, or runtime is justified.

## Resource boundary

Each slot owns one named Buildx builder. The builder uses Docker's
`docker-container` driver so its BuildKit daemon has enforceable container resource
limits. The checked-in slot policy supplies:

- a 16 GiB memory ceiling, empirically raised from 12 GiB after the bounded
  representative build reached page-data collection but BuildKit correctly
  terminated it with `ResourceExhausted`; this leaves substantial host headroom
  while accommodating the proven 8 GiB Node heap plus Next worker memory;
- an eight-CPU quota with a 100 ms period;
- BuildKit `max-parallelism = 4`;
- `default-load=true`, preserving the image-inspection and artifact identity path.

Provisioning is idempotent and fail closed. An absent builder may be created. An
existing builder whose driver or effective HostConfig does not match the declared
policy is drift, not permission to run unbounded. The gate reports the mismatch and
stops; it does not silently recreate or resize shared infrastructure.

## Control-plane watchdog

The bounded build wrapper starts the Buildx build and samples every five seconds:

- `GET http://127.0.0.1:3000/api/health`, requiring HTTP 200 and an identifiable
  healthy payload;
- a read-only MCP request, requiring a valid protocol response;
- `docker info`, with a short process timeout;
- `SELECT 1` over `127.0.0.1:5432`, independently of `docker exec`.

The wrapper resolves the installed PostgreSQL container's live credentials once
before the build, retains the connection URL only in process memory, and never
serializes it. Subsequent database samples use the host port directly, so they
remain independent if Docker Engine becomes unresponsive.

Every probe has an individual timeout. Two consecutive unhealthy sample rounds form
a sustained breach. This avoids one transient packet becoming a false rollback while
bounding detection to approximately ten seconds. The wrapper then terminates the
complete build client process tree, emits a versioned JSON evidence record, and exits
with reserved code 5.

The record contains branch, candidate SHA, integration tree SHA when available, slot,
builder policy, timestamps, every probe result, breach reason, and termination result.
Secrets and connection strings are never serialized.

## Outcome semantics

Exit code 5 maps to `blocked_control_plane_starvation`. It is:

- an infrastructure/control-plane failure, not a product build failure;
- a binding circuit-breaker input for any slot and especially slot 1;
- a binding rollback blocker in the capacity pilot report;
- never convertible to `failed` merely because an older portal does not yet know the
  enum—the pending evidence remains explicit and is finalized after deployment.

Normal Docker build errors remain `failed`. Dependency drift remains
`blocked_sandbox_drift`. The statuses are intentionally disjoint.

## Recovery and rollout

The watchdog may stop only its admitted build process tree. It may not restart or
stop shared DPF services. If the control plane remains unavailable after termination,
the gate records `recovery_required` with the failed probes and the operator-visible
next action. A Docker Desktop or shared-service restart requires explicit authority
and must be auditable.

Requested capacity remains one. A future pilot can request two only after repeated
bounded-build evidence proves the control plane healthy throughout representative
builds. The prior rollback remains binding until that new evidence exists.

## Verification contract

- unit tests prove builder command/limit validation, timeout handling, sustained
  breach classification, process-tree termination, status mapping, and pilot rollback;
- a representative harness runs a controlled long build with all four probes healthy;
- a fault-injection harness makes each probe fail and proves exit 5 plus evidence;
- the exact local-CI pregate proves the Docker artifact still builds and records the
  bounded policy;
- portal/MCP/PostgreSQL/Docker health is sampled before, during, and after the gate.
