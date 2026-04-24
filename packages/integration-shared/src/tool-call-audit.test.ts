import { describe, expect, it } from "vitest";

import { hashToolArgs } from "./tool-call-audit";

describe("tool-call-audit", () => {
  it("produces a stable hash regardless of input key order", () => {
    const left = hashToolArgs({
      workerId: "EMP0042",
      fromDate: "2026-04-01",
      toDate: "2026-04-30",
    });

    const right = hashToolArgs({
      toDate: "2026-04-30",
      workerId: "EMP0042",
      fromDate: "2026-04-01",
    });

    expect(left).toBe(right);
    expect(left).toMatch(/^[a-f0-9]{64}$/);
  });
});
