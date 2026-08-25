---
status: active
---

# Local-CI MCP probe hysteresis (`BI-9DC21917`)

## Evidence

PR #4643 replaced one global control-plane failure counter with independent
portal, MCP, Docker, and PostgreSQL counters. Two subsequent exact-tree gates
still fenced during OCI tarball handoff. In receipts
`cmt8di8830odw01mgdrnl3u7j` and `cmt8dohy80oky01mg5lj0p5hm`, portal, Docker,
and PostgreSQL remained healthy while the authenticated MCP probe exceeded its
2.5-second request budget twice. The first run had passed exhaustive tests and
compiled the production application; the second reproduced from cached build
output. This is a same-surface hysteresis defect, not product red and not the
repaired cross-surface counter defect.

## Objectives and acceptance

- **OBJ-MCP-RECOVERY / AC-MCP-RECOVERY:** Two consecutive bounded MCP request
  misses during the build watchdog can recover; a third consecutive miss fences
  as `blocked_control_plane_starvation`.
- **OBJ-STRICT-FENCE / AC-STRICT-SURFACES:** Portal, Docker, and PostgreSQL keep
  their two-consecutive-miss fail-closed boundary.
- **OBJ-STRICT-FENCE / AC-PREFLIGHT:** All four surfaces must still be healthy
  before BuildKit starts.
- **OBJ-EVIDENCE / AC-LIMIT-EVIDENCE:** Every build-watchdog sample records the
  effective per-surface limits beside its counters.
- **OBJ-SCOPE / AC-NO-BROADEN:** Probe cadence, the 2.5-second request timeout,
  product tests, build semantics, lease lifecycle, and installed runtime remain
  unchanged.

## Architecture

`scripts/lib/local-ci-control-plane-watchdog.mjs` remains the single owner of
build-watchdog hysteresis. Its default policy is a four-entry immutable map:
portal `2`, MCP `3`, Docker `2`, PostgreSQL `2`. The existing scalar override is
retained for deterministic tests and explicit callers; it overrides every map
entry and must remain a positive integer. `scripts/local-ci-bounded-build.mjs`
continues as the only production caller and requires no new probe, request, or
environment variable.

This is a bounded tolerance correction, not a gate relaxation. At the existing
five-second cadence, the MCP route must remain unavailable across a third
consecutive sample before fencing. Preflight still requires an immediately
healthy sample. Missing probes and invalid limits fail closed.

## Verification and blast radius

- TDD reproduces the two-miss false fence and proves recovery.
- A three-miss counterexample proves sustained MCP degradation still fences.
- Existing same-surface, alternating-surface, preflight, termination, stage
  receipt, and bounded-builder tests remain green.
- Raw importer analysis identifies one production caller; no UI, schema, route,
  migration, seed, deployment, or business-archetype surface changes.
- Decision `DI-F858F9EB93E0` remains the governing surface-hysteresis choice.

