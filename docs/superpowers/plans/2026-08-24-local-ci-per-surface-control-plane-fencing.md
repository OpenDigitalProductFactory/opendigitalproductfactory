---
status: active
---

# Local-CI per-surface control-plane fencing

Backlog item: `BI-9DC21917`  
Workroom: `WC-7E4580C0`  
Decision: `DI-F858F9EB93E0`

## Evidence and diagnosis

Three exact-tree local-CI attempts for the frozen self-upgrade candidate completed substantive test and build work, then fenced as `blocked_control_plane_starvation`. Receipt-level inspection showed that a portal miss followed by an MCP miss increments one global consecutive-failure counter to its limit even though neither surface missed twice consecutively.

The watchdog currently evaluates portal, MCP, Docker, and PostgreSQL together. Its sample is healthy only when every surface is healthy, but its hysteresis state is a single scalar shared by all surfaces. That conflates independent transient misses and creates a false cross-surface fence.

## Required behavior

- Keep the strict preflight invariant: all four surfaces must be healthy before build work starts.
- Track consecutive misses independently for portal, MCP, Docker, and PostgreSQL during the build watchdog.
- Reset only the counter for a surface that recovers.
- Fence when any one surface reaches the configured consecutive-failure limit.
- Treat an absent probe as unhealthy and preserve the existing fail-closed exit classification.
- Report the surface or surfaces that breached the limit so the evidence is actionable.
- Do not change the configured limit, probe cadence, product gates, or candidate under test.

## Test-first implementation

1. Add a failing regression where a portal-only miss is followed by an MCP-only miss. The watchdog must not fence.
2. Add a failing regression where the same surface misses in consecutive samples. The watchdog must fence at the existing limit.
3. Add a failing regression proving a recovered surface resets only its own counter while another surface retains its consecutive history.
4. Preserve and run the strict all-surface preflight cases, including missing-probe behavior.
5. Replace the shared scalar with bounded per-surface state and include the tripping surface names in the terminal result.
6. Run the focused watchdog suite, pregate, and governed exact-tree local CI before publication.

## Acceptance

The repair is accepted only when the focused tests prove alternating-surface tolerance and same-surface fail-closed behavior, semantic review passes on the committed tree, and one unchanged-SHA local-CI rerun completes without the false global-counter fence.
