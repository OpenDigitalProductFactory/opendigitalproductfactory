import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveWorkOwner = vi.hoisted(() => vi.fn());
vi.mock("@/lib/portfolio/accountable-owner", () => ({ resolveWorkOwner }));

import { resolveScheduledOwnerUserId } from "./scheduled-owner";

const db = {} as never;

beforeEach(() => {
  resolveWorkOwner.mockReset();
});

// BI-67B27832: scheduled work used to go to the oldest superuser, which is the
// seeded bootstrap account nobody signs in with. It now follows the portfolio.
describe("resolveScheduledOwnerUserId", () => {
  it("returns the portfolio-aligned owner for platform work (Foundational by default)", async () => {
    resolveWorkOwner.mockResolvedValue({ userId: "u-mark", source: "foundational" });
    await expect(resolveScheduledOwnerUserId(db)).resolves.toBe("u-mark");
    expect(resolveWorkOwner).toHaveBeenCalledWith(db, {});
  });

  it("passes the work's portfolio through so its owner answers for it", async () => {
    resolveWorkOwner.mockResolvedValue({ userId: "u-owner", source: "portfolio" });
    await expect(resolveScheduledOwnerUserId(db, { portfolioId: "pf-1" })).resolves.toBe("u-owner");
    expect(resolveWorkOwner).toHaveBeenCalledWith(db, { portfolioId: "pf-1" });
  });

  it("fails loudly rather than resolve to a non-existent owner", async () => {
    resolveWorkOwner.mockImplementation(async () => {
      throw new Error("No accountable owner");
    });
    await expect(resolveScheduledOwnerUserId(db)).rejects.toThrow(/owner/i);
  });
});
