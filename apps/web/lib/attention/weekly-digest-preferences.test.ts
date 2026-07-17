import { describe, expect, it, vi } from "vitest";

import {
  loadWeeklyDigestDisposition,
  saveWeeklyDigestDisposition,
  weeklyDigestFactKey,
} from "./weekly-digest-preferences";

describe("weekly digest preferences", () => {
  it("uses one dated preference key per Friday review", () => {
    expect(weeklyDigestFactKey("2026-07-17")).toBe("ownerAttentionDigest:2026-07-17");
    expect(() => weeklyDigestFactKey("Friday")).toThrow(/review date/i);
  });

  it("loads a saved disposition and ignores malformed values", async () => {
    const db = {
      userFact: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ value: JSON.stringify({ disposition: "snoozed" }) })
          .mockResolvedValueOnce({ value: "not-json" }),
      },
    };

    await expect(
      loadWeeklyDigestDisposition(db as never, "user-1", "2026-07-17"),
    ).resolves.toBe("snoozed");
    await expect(
      loadWeeklyDigestDisposition(db as never, "user-1", "2026-07-17"),
    ).resolves.toBeNull();
  });

  it("updates the active fact instead of creating a parallel digest record", async () => {
    const db = {
      userFact: {
        findFirst: vi.fn().mockResolvedValue({ id: "fact-1" }),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({}),
      },
    };

    await saveWeeklyDigestDisposition(
      db as never,
      "user-1",
      "2026-07-17",
      "cleared",
      new Date("2026-07-17T12:00:00Z"),
    );

    expect(db.userFact.update).toHaveBeenCalledWith({
      where: { id: "fact-1" },
      data: expect.objectContaining({
        value: JSON.stringify({ disposition: "cleared" }),
        lastValidatedAt: new Date("2026-07-17T12:00:00Z"),
      }),
    });
    expect(db.userFact.create).not.toHaveBeenCalled();
  });
});
