import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  executeRaw: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));

import { createPrismaWorkPatternActivationPersistence } from "./work-pattern-activation-persistence";

describe("createPrismaWorkPatternActivationPersistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeRaw.mockResolvedValue(1);
    mocks.transaction.mockImplementation(async (work) =>
      work({
        $executeRaw: mocks.executeRaw,
        agent: {},
        authorityBinding: {},
        decisionShadowLedger: {},
      }));
  });

  it("acquires a parameterized advisory lock inside a serializable transaction", async () => {
    const snapshot = vi.fn().mockResolvedValue({ marker: "fresh" });
    const persistence = createPrismaWorkPatternActivationPersistence(snapshot);

    const result = await persistence.withActivationLock(
      "WP-PATTERN-123",
      (session) => session.readSnapshot(),
    );

    expect(result).toEqual({ marker: "fresh" });
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
    const [strings, laneKey] = mocks.executeRaw.mock.calls[0];
    expect(strings.join("?")).toContain("pg_advisory_xact_lock(hashtextextended(?, 0))");
    expect(laneKey).toBe("WP-PATTERN-123");
    expect(mocks.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" },
    );
  });
});
