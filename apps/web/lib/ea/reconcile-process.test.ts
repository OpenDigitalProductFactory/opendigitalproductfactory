import { describe, expect, it, vi } from "vitest";
import { reconcileProcessModels, PLATFORM_PROCESS_MACHINES } from "./reconcile-process";

describe("reconcileProcessModels", () => {
  it("applies the process registry under the bpmn20 notation (skips cleanly if absent)", async () => {
    const db = { eaNotation: { findUnique: vi.fn().mockResolvedValue(null) } };
    const r = await reconcileProcessModels({ db: db as never });
    expect(r.status).toBe("skipped");
    expect(db.eaNotation.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: "bpmn20" } }));
  });

  it("registers the platform state machines as well-formed descriptors", () => {
    expect(PLATFORM_PROCESS_MACHINES.length).toBeGreaterThanOrEqual(2);
    for (const m of PLATFORM_PROCESS_MACHINES) {
      expect(m.statuses.length).toBeGreaterThan(0);
      // Every machine has at least one terminal state and one live (non-terminal) state.
      expect(m.statuses.some((s) => m.isTerminal(s))).toBe(true);
      expect(m.statuses.some((s) => !m.isTerminal(s))).toBe(true);
      // Self-transitions are never real BPMN edges.
      expect(m.statuses.every((s) => !m.canTransition(s, s))).toBe(true);
    }
  });
});
