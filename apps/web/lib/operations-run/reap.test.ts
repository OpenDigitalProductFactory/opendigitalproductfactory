import { describe, expect, it, vi } from "vitest";

import { reap } from "./reap";

describe("reap framework (EP-8DC217EB BET-10)", () => {
  it("scans once, gates each candidate, and tallies settled rows", async () => {
    const transition = vi.fn(async (n: number) => (n > 0 ? 1 : 0));
    const result = await reap<number>({
      scan: async () => [1, 0, 2, 0, 3],
      isReapable: (n) => n > 0,
      transition,
    });
    expect(result.scanned).toBe(5);
    expect(result.reaped).toBe(3); // 1,2,3 transitioned; the two 0s gated out
    expect(transition).toHaveBeenCalledTimes(3);
  });

  it("counts only rows the transition actually settled (lost re-check races return 0)", async () => {
    const result = await reap<number>({
      scan: async () => [1, 2, 3],
      isReapable: () => true,
      transition: async (n) => (n === 2 ? 0 : 1), // row 2 lost its race
    });
    expect(result.reaped).toBe(2);
  });

  it("isolates a throwing transition per-row and continues the sweep", async () => {
    const onError = vi.fn();
    const result = await reap<number>({
      scan: async () => [1, 2, 3],
      isReapable: () => true,
      transition: async (n) => {
        if (n === 2) throw new Error("boom");
        return 1;
      },
      onError,
    });
    expect(result.reaped).toBe(2); // 1 and 3 still settled
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(2, expect.any(Error));
  });

  it("an empty scan reaps nothing", async () => {
    const transition = vi.fn();
    const result = await reap<number>({ scan: async () => [], isReapable: () => true, transition });
    expect(result).toEqual({ scanned: 0, reaped: 0 });
    expect(transition).not.toHaveBeenCalled();
  });
});
