---
status: active
---

# Local-CI request-surface probe hysteresis (`BI-9DC21917`)

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

The pet-rescue housing candidate then reproduced the wider request-surface
failure on current `main`. Exact-tree receipts `cmtmk2rts01x001pb9og9cncq`,
`cmtmkfhjh02s301pbxnk86mtc`, and `cmtmkvqo2000e01pby30wcre0` all reached the
bounded production-build stage. One passed guards, typecheck, affected tests,
and the Next.js production compile before two 15-second portal misses during
OCI layer export; another recorded bounded portal and MCP request misses while
Docker and PostgreSQL stayed healthy. Both surfaces recovered after the fence.
This proves that the build-only two-sample boundary is too narrow for the two
HTTP-backed request surfaces under bounded OCI-export load.

## Objectives and acceptance

- **OBJ-REQUEST-RECOVERY:** Allow two consecutive bounded portal or MCP request
  misses during the build watchdog to recover while sustained degradation on
  either request surface still fences.
- **OBJ-STRICT-FENCE:** Preserve the existing fail-closed boundaries for the
  process-local Docker/PostgreSQL surfaces and for preflight.
- **OBJ-EVIDENCE:** Make the effective per-surface watchdog limits explicit in
  each build-watchdog sample.
- **OBJ-SCOPE:** Keep the correction confined to build-watchdog hysteresis.

| Acceptance ID | Objective ID | Statement |
| --- | --- | --- |
| AC-REQUEST-RECOVERY | OBJ-REQUEST-RECOVERY | Two consecutive bounded portal or MCP request misses recover; a third consecutive miss on either surface fences as `blocked_control_plane_starvation`. |
| AC-STRICT-SURFACES | OBJ-STRICT-FENCE | Docker and PostgreSQL retain their two-consecutive-miss fail-closed boundary. |
| AC-PREFLIGHT | OBJ-STRICT-FENCE | All four control-plane surfaces are healthy before BuildKit starts. |
| AC-LIMIT-EVIDENCE | OBJ-EVIDENCE | Every build-watchdog sample records the effective per-surface limits beside its counters. |
| AC-NO-BROADEN | OBJ-SCOPE | Probe cadence, the 15-second request timeout, product tests, build semantics, lease lifecycle, and installed runtime remain unchanged. |

## Architecture

`scripts/lib/local-ci-control-plane-watchdog.mjs` remains the single owner of
build-watchdog hysteresis. Its default policy is a four-entry immutable map:
portal `3`, MCP `3`, Docker `2`, PostgreSQL `2`. The existing scalar override is
retained for deterministic tests and explicit callers; it overrides every map
entry and must remain a positive integer. `scripts/local-ci-bounded-build.mjs`
continues as the only production caller and requires no new probe, request, or
environment variable.

This is a bounded tolerance correction, not a gate relaxation. At the existing
five-second cadence and 15-second request budget, a portal or MCP route must
remain unavailable across a third consecutive sample before fencing: at most
about 55 seconds from the beginning of the first timed-out request. Preflight
still requires a healthy sample within its existing bounded attempts. Missing
probes and invalid limits fail closed.

## Verification and blast radius

- TDD reproduces two consecutive portal misses and two consecutive MCP misses,
  then proves recovery without fencing.
- Three-miss counterexamples prove sustained portal and MCP degradation still
  fences.
- Existing same-surface, alternating-surface, preflight, termination, stage
  receipt, and bounded-builder tests remain green.
- Raw importer analysis identifies one production caller; no UI, schema, route,
  migration, seed, deployment, or business-archetype surface changes.
- Decision `DI-F858F9EB93E0` remains the governing surface-hysteresis choice.
