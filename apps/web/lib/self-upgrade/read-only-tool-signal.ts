/**
 * Which tool calls count as portal ACTIVITY for the quiescence drain, and which
 * are merely someone OBSERVING it (BI-2C7F51BA Defect 3).
 *
 * Every MCP call writes a ToolExecution row, INCLUDING read-only ones. That
 * makes a waiter indistinguishable from a worker to the B-class
 * `request.recent-tool-execution` signal: the local-CI gate's own liveness poll
 * — and `get_quiescence_status` itself, a read explicitly permitted during
 * quiescence — each re-arm the soft blocker they are waiting on. Observed twice
 * on 2026-08-04: a coordinator sat at `ready-to-swap` with exactly ONE drain
 * blocker, `request.recent-tool-execution` count 1, which was the waiting gate's
 * own polling. The drain could not complete because the gate was waiting, and
 * the gate could not admit because the drain refused new lease claims.
 *
 * The same argument was already accepted one stage earlier, at TRIGGER time, in
 * `lib/queue/functions/self-upgrade.ts` (BI-CC82B9A8): a soft blocker that fires
 * on the very calls that drove the request makes the operation un-runnable while
 * someone is driving it. That reasoning was never carried through to the
 * DRAIN/SWAP stage, which is where this deadlock occurs.
 *
 * The remedy is deliberately NARROWER than "ignore soft blockers at swap time":
 * the scheduled / unattended path is intentionally conservative (BI-F36E7510)
 * and must keep honouring soft blockers. What changes is the SIGNAL — an
 * observation is not activity. Mutating tool calls still block the drain
 * exactly as before.
 */

let readOnlyToolNamesPromise: Promise<string[]> | null = null;

/**
 * Tool names the activity signal must ignore, derived from the canonical
 * `resolveAnnotations().readOnlyHint` — so a tool flipping to
 * `sideEffect: true` automatically re-enters the signal with no list to
 * maintain here.
 *
 * `mcp-tools` is imported LAZILY: it reaches the quiescence module through the
 * self-upgrade tool pack, and that pack already uses a dynamic import for the
 * same reason. Resolved once and cached for the process.
 */
export function resolveReadOnlyToolNames(): Promise<string[]> {
  if (!readOnlyToolNamesPromise) {
    readOnlyToolNamesPromise = import("@/lib/mcp-tools")
      .then(({ PLATFORM_TOOLS, resolveAnnotations }) =>
        PLATFORM_TOOLS.filter((tool) => resolveAnnotations(tool).readOnlyHint === true).map(
          (tool) => tool.name,
        ),
      )
      .catch((err) => {
        // Fail OPEN toward the pre-BI-2C7F51BA behaviour: with no exclusion list
        // the signal is exactly what it always was (over-eager, never
        // under-eager), so a resolution failure cannot let a genuinely busy
        // portal swap underneath live work.
        console.warn("[quiescence] could not resolve read-only tool names:", err);
        readOnlyToolNamesPromise = null;
        return [];
      });
  }
  return readOnlyToolNamesPromise;
}
