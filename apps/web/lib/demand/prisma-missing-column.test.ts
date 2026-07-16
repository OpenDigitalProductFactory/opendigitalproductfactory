import { describe, expect, it } from "vitest";
import { isPrismaMissingColumnError } from "./prisma-missing-column";

describe("isPrismaMissingColumnError (BI-PIR-1d2d84a3)", () => {
  it("matches Prisma missing-column messages from live /ops/demand crash", () => {
    const msg =
      "The column `BacklogItem.estimateAiJobSize` does not exist in the current database.";
    expect(isPrismaMissingColumnError(new Error(msg))).toBe(true);
    expect(isPrismaMissingColumnError(msg)).toBe(true);
  });

  it("rejects unrelated errors", () => {
    expect(isPrismaMissingColumnError(new Error("Connection refused"))).toBe(false);
    expect(isPrismaMissingColumnError(null)).toBe(false);
  });
});
