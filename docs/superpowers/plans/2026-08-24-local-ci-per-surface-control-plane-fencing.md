---
status: active
---

# Local-CI per-surface control-plane fencing

- Backlog item: `BI-9DC21917`
- Workroom: `WC-1DC83FE8` (successor to `WC-7E4580C0`)
- Decision: `DI-F858F9EB93E0`
- Design: `docs/superpowers/specs/2026-08-25-local-ci-mcp-probe-hysteresis-design.md`

## Evidence and diagnosis

Three exact-tree local-CI attempts for the frozen self-upgrade candidate completed substantive test and build work, then fenced as `blocked_control_plane_starvation`. Receipt-level inspection showed that a portal miss followed by an MCP miss increments one global consecutive-failure counter to its limit even though neither surface missed twice consecutively.

The watchdog currently evaluates portal, MCP, Docker, and PostgreSQL together. Its sample is healthy only when every surface is healthy, but its hysteresis state is a single scalar shared by all surfaces. That conflates independent transient misses and creates a false cross-surface fence.

The first repair reached `origin/main` through PR #4643 and removed that
cross-surface counter. Two later gates on immutable candidate
`0dc592df29605c59860bd71ee3337d1299ff60a1` then exposed the remaining
same-surface boundary. During OCI tarball handoff, portal, Docker, and
PostgreSQL stayed healthy while the MCP probe missed its 2.5-second request
budget twice. The first gate had already passed exhaustive tests and compiled
the production application; the explicit retry reused cached build output and
reproduced the two MCP misses. Evidence receipts are
`cmt8di8830odw01mgdrnl3u7j` and `cmt8dohy80oky01mg5lj0p5hm`.

Three later exact-tree runs for the pet-rescue housing candidate reproduced the
same boundary on current `main`: `cmtmk2rts01x001pb9og9cncq`,
`cmtmkfhjh02s301pbxnk86mtc`, and `cmtmkvqo2000e01pby30wcre0`. The most complete
run passed guards, typecheck, affected tests, and production compilation before
two 15-second portal misses during OCI layer export. Docker and PostgreSQL
remained healthy, and the portal recovered after the fence. Another run
recorded bounded portal and MCP request misses in the same export phase. These
receipts make the repair apply symmetrically to the two HTTP-backed request
surfaces while retaining stricter process-local infrastructure boundaries.

## Required behavior

This ordered fix sequence traces the immutable objective baseline directly:

- `OBJ-REQUEST-RECOVERY`: implement `CONTRACT-PER-SURFACE-HYSTERESIS` in
  `FLOW-BUILD-WATCHDOG` so portal and MCP tolerate two bounded consecutive
  request misses and fence on the third.
- `OBJ-STRICT-FENCE`: retain `CONTRACT-STRICT-PREFLIGHT` and the existing
  two-miss Docker/PostgreSQL fail-closed boundary in `FLOW-BUILD-WATCHDOG`.
- `OBJ-EVIDENCE`: include each effective surface limit beside the corresponding
  counter in every `FLOW-BUILD-WATCHDOG` sample.
- `OBJ-SCOPE`: change only watchdog hysteresis and its focused tests; keep probe
  cadence, request timeout, product gates, lease lifecycle, and runtime intact.

- Keep the strict preflight invariant: all four surfaces must be healthy before build work starts.
- Track consecutive misses independently for portal, MCP, Docker, and PostgreSQL during the build watchdog.
- Reset only the counter for a surface that recovers.
- Keep Docker and PostgreSQL fail-closed at two consecutive misses.
- Give both portal and authenticated MCP probes a three-miss build-watchdog
  boundary, so two bounded request misses under OCI handoff can recover while a
  third still fences sustained degradation.
- Treat an absent probe as unhealthy and preserve the existing fail-closed exit classification.
- Report both the per-surface counters and effective limits so the evidence is
  actionable.
- Do not change probe cadence, per-request timeout, product gates, or the
  candidate under test.

## Test-first implementation

1. Add a failing regression where a portal-only miss is followed by an MCP-only miss. The watchdog must not fence.
2. Add a failing regression where the same surface misses in consecutive samples. The watchdog must fence at the existing limit.
3. Add a failing regression proving a recovered surface resets only its own counter while another surface retains its consecutive history.
4. Preserve and run the strict all-surface preflight cases, including missing-probe behavior.
5. Replace the shared scalar with bounded per-surface state and include the tripping surface names in the terminal result.
6. Add regressions that two consecutive portal and MCP request misses recover
   at their default boundaries, with counterexamples that each third miss
   fences.
7. Run the focused watchdog/bounded-build suite, pregate, and governed
   exact-tree local CI before publication.

## Backlog coverage

- Decision: atomic
- Parent: `BI-9DC21917`
- Receipt: pending
- Dependencies: none
- Deliverable: `local-ci-per-surface-control-plane-fencing` → `BI-9DC21917`
- Rationale: preflight, per-surface counters, surface-specific hysteresis,
  evidence fields, and fail-closed terminal classification are one watchdog
  safety boundary.
- Blocking condition: no initiative scope baseline exists for `BI-9DC21917`;
  independent spec approval must create it before coverage can be recorded.

## Acceptance

The repair is accepted only when focused tests and delivery evidence satisfy
the complete baseline:

- `AC-REQUEST-RECOVERY`: portal and MCP each recover after two bounded misses,
  while a third consecutive miss fences.
- `AC-STRICT-SURFACES`: Docker and PostgreSQL still fence after two consecutive
  misses.
- `AC-PREFLIGHT`: strict all-surface health remains mandatory before BuildKit.
- `AC-LIMIT-EVIDENCE`: each sample records the effective per-surface limits.
- `AC-NO-BROADEN`: cadence, the 15-second request timeout, product tests, build
  semantics, lease lifecycle, and installed runtime remain unchanged.

Semantic review must cover the committed tree, and one unchanged-SHA local-CI
rerun must complete without a false control-plane fence.
