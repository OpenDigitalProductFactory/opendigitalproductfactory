import { describe, expect, it, vi } from "vitest";

import { loadStorefrontOperatingTimezone } from "./storefront-operating-timezone.server";

describe("loadStorefrontOperatingTimezone", () => {
  it("uses the operator-pinned BusinessProfile timezone instead of the stale storefront default", async () => {
    const findFirst = vi.fn(async () => ({ timezone: "America/Chicago" }));

    await expect(
      loadStorefrontOperatingTimezone({ businessProfile: { findFirst } }),
    ).resolves.toBe("America/Chicago");
    expect(findFirst).toHaveBeenCalledWith({
      where: { isActive: true },
      select: { timezone: true },
    });
  });

  it("uses the same UTC fallback as Operating Hours when no active profile exists", async () => {
    const findFirst = vi.fn(async () => null);

    await expect(
      loadStorefrontOperatingTimezone({ businessProfile: { findFirst } }),
    ).resolves.toBe("UTC");
  });
});
