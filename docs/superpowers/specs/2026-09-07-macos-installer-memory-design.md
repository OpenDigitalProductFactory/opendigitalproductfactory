# Size Docker memory during macOS installation

Backlog: BI-DC4352E8. Epic: EP-56AE0F69. Workroom: WC-5DE121A4.
Status: proposed; implementation awaits governed review and coverage.

## Problem and reproduction

On the operator's 128 GiB Mac, Docker Desktop had `MemoryMiB: 70144`.
Containers reported approximately 5 GiB in use, while the guest held large
reclaimable caches. macOS reported a roughly 69 GiB VM footprint. A separate
Chatterbox service used 71 GiB and was disabled; that service is outside this
change. After an authorized Docker stop, setting `MemoryMiB: 32768`, and start,
the persisted setting and Docker's live `MemTotal` agreed and the portal became
healthy. This establishes the local remediation, not proof of a fleet fix.

At commit `050e5d4ed20bf49a1531428544252e67a26ffb15`,
`install-dpf.sh:409` invokes `dpf_preflight_docker_memory`. The implementation
in `scripts/installer/lib/preflight.sh:175` warns about high allocation and
returns success without changing it. Reproduction on that ref used real Bash
with the preflight library and mocked `uname`, `sysctl`, and `docker info`:
Darwin, 137438953472 host bytes, and 73551314944 guest bytes. Output reported
70144 MiB, warned it exceeded 50%, then returned success. No allocation or
restart command was requested. This fails the required installation outcome.

The live checks rule out a missing Docker daemon and absent RAM as causes:
Docker was reachable, host RAM was 128 GiB, and the containers were healthy.
Restart alone is not persistent sizing: the settings file still supplies the
next VM allocation. Do not infer a Docker or Chatterbox leak from these values.

## Research & Benchmarking

- [Docker Desktop settings](https://docs.docker.com/desktop/settings-and-maintenance/settings/)
  document a default VM memory limit of 50% and the macOS settings-store path.
  Use that existing settings surface; do not create a second DPF memory store.
- [Docker Desktop stop](https://docs.docker.com/reference/cli/docker/desktop/stop/)
  provides graceful stop with a timeout. Use stop/start, never force-kill a VM.
- [Docker Settings Management](https://docs.docker.com/enterprise/security/hardened-desktop/settings-management/configure-json-file/)
  is the enterprise authority. Do not rewrite administrator-managed settings.
  If managed policy prevents convergence, report it instead of working around it.

This is a defect in the existing installation resource step, not adoption of
a new runtime. Native Linux and Windows/WSL memory ownership remain unchanged.

## Requirements

- R1: For local Docker Desktop on supported macOS, derive a default upper
  allocation of `min(32768, max(8192, floor(hostMiB / 4096) * 1024))` MiB.
  This is one quarter of RAM rounded down to a GiB, with an 8 GiB floor and
  32 GiB cap. Hosts below 16 GiB cannot meet the floor while leaving half for
  the host and must receive a clear unsupported-capacity result.
- R2: Preserve an existing integer allocation within 8192 MiB and the derived
  upper bound. Correct allocations outside that range to the derived target.
  A matching saved setting is only converged when live `MemTotal` agrees,
  allowing up to 5% guest kernel overhead. A pending saved change needs restart.
- R3: Operate only on local Docker Desktop. Never change a remote endpoint,
  another container runtime, Windows, or Linux. Dry-run must not write or restart.
- R4: Changing the VM interrupts all its containers and host model runner work.
  Explain that before applying. With running containers, require interactive
  consent (default no) or explicit `--allow-docker-restart`; `--headless` alone
  is not consent. No-running-container setup can converge automatically. Restore
  all previously running container IDs, including restart-policy `no` containers.
- R5: Reject malformed, missing, symlinked, or administrator-managed settings
  before stopping Docker. Support the documented current settings-store path.
  Preserve unrelated keys; write a uniquely named backup and atomically replace
  the settings only after graceful stop succeeds. Do not print settings contents.
- R6: Bound lifecycle waits. Stop failure must leave settings untouched. Write
  failure must attempt to restart the unchanged configuration. Start or readback
  failure must stop installation with the backup path and accurate recovery
  status. Do not force-stop, silently claim success, or erase evidence.
- R7: Re-running the installer is idempotent. This change is not an automatic
  rollout to existing installs and does not run on normal portal self-upgrade.

## Contracts and flow

C1: Extend the existing `install-dpf.sh` Docker resource step after its Node
runtime prerequisite is checked and before dependencies, image work or Compose
startup. Keep the existing minimum-memory preflight after convergence.

C2: Put macOS settings parsing, sizing and bounded Docker lifecycle operations
in one dependency-free installer helper, `scripts/installer/macos-docker-memory.mjs`.
Keep host paths and Docker settings keys inside that adapter. Export pure sizing
and validation functions for Node tests; the CLI performs mutations only on its
explicit apply path. Use existing installer prompt conventions for consent.

F1: platform/context detection -> inspect host, settings, live memory and active
containers -> calculate target -> no-op or explain restart -> consent where
required -> graceful stop -> re-read and preserve settings -> backup/atomic write
-> start/wait -> restore prior containers -> verify saved and live memory.

F2: Any failed prerequisite ends before mutation. Failures after stopping include
the actual state and backup location, and return nonzero to the installer.

## Ordered implementation and verification

One atomic deliverable, owned by BI-DC4352E8: installer allocation, lifecycle
safety, tests and operator documentation form one independently reviewable fix.

1. V1: Add Node built-in tests that invoke the helper with fake filesystem and
   Docker lifecycle boundaries. Prove the absent behavior fails before coding.
2. Implement C2/R1-R6. Test 16/24/32/64/128/256 GiB hosts, low/unknown RAM,
   already-correct allocation, pending restart, invalid JSON, symlinks, managed
   policy, unsupported/remote contexts, cancellation, stop/write/start failures,
   readback mismatch, running-container restoration, and idempotent rerun.
3. Wire C1/F1 into installation, including dry-run and restart-consent flag.
   V2: Exercise real Bash integration with mocked host commands; assert the call
   occurs after runtime prerequisites and before existing memory preflight.
4. Update `docs/install/macos.md` and the platform-support watchlist. V3: Run
   affected Node tests, Bash syntax checks, whitespace and documentation checks.
5. V4: Runtime-bound installation acceptance belongs to the canonical/shared
   leased environment. The prior operator-authorized manual restart is incident
   evidence, not execution evidence for unimplemented helper code. Report any
   unavailable runtime test as unrun; cloud build checks govern PR delivery.

## Risks, rollback and scope limits

Docker Desktop settings are shared with non-DPF workloads. Consent and restoring
the observed running set protect that boundary. A concurrent settings change is
re-read after stop; managed-policy detection and live readback fail closed.
An existing desired allocation outside the range will be presented before a
disruptive change; declining ends setup with an actionable explanation.

The 32 GiB cap is a conservative initial policy, not a measured peak-workload
guarantee. Container limits and host-side model sizing are separate controls.
No schema, route, application UI, Windows settings, or model configuration changes.
Rollback is the saved Docker settings backup applied while Docker is stopped,
then a normal start and verification. Source rollback is one PR revert.

## Backlog coverage

Implementation parent: BI-DC4352E8. Canonical plan: this document's ordered
implementation section. Atomic mapping: R1-R7 -> C1-C2 -> F1-F2 -> V1-V4.
The live coverage receipt is pending review of this immutable design artifact;
this document does not claim a passing receipt or authorize implementation.
