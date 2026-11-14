import { describe, expect, it } from "vitest";

// BI-1687CCD2: a runtime thread handed to the other CLI starts from the room's
// log, newest work kept first within a fixed budget, coverage recorded.

import { renderRuntimeHandoff } from "./runtime-handoff";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 28, 12, minute));
const entry = (minute: number, kind: string, summary: string) => ({ kind, summary, recordedAt: at(minute), sequence: minute });

describe("renderRuntimeHandoff", () => {
  it("renders the log oldest first under a header naming both CLIs", () => {
    const handoff = renderRuntimeHandoff({
      entries: [entry(1, "action", "codex started a turn"), entry(2, "response", "Ran the tests:\n 12 passed")],
      fromProvider: "codex",
      toProvider: "claude",
    });
    expect(handoff).toMatchObject({ included: 2, omitted: 0 });
    expect(handoff.text).toMatch(/moves from codex to claude/);
    expect(handoff.text.indexOf("codex started a turn")).toBeLessThan(handoff.text.indexOf("Ran the tests: 12 passed"));
    expect(handoff.bytes).toBe(Buffer.byteLength(handoff.text));
  });

  it("keeps the newest entries that fit the budget and says how many it left out", () => {
    const entries = Array.from({ length: 50 }, (_, index) => entry(index, "response", `step ${index} ${"x".repeat(80)}`));
    const handoff = renderRuntimeHandoff({ entries, fromProvider: "claude", toProvider: "codex", budgetBytes: 2_000 });
    expect(handoff.included).toBeGreaterThan(0);
    expect(handoff.included + handoff.omitted).toBe(50);
    expect(handoff.text).toContain("step 49");
    expect(handoff.text).not.toContain("step 0 ");
    expect(handoff.text).toMatch(new RegExp(`${handoff.omitted} earlier entries left out`));
    expect(handoff.bytes).toBeLessThanOrEqual(2_000 + 100);
  });
});
