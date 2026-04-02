import { describe, expect, it } from "vitest";

import {
  hashPasswordResetToken,
  isPasswordResetExpired,
  resolvePasswordResetDeliveryMode,
} from "./password-reset";

describe("password reset helpers", () => {
  it("hashes reset tokens before persistence", async () => {
    await expect(hashPasswordResetToken("raw-token")).resolves.not.toBe("raw-token");
  });

  it("rejects expired reset tokens", () => {
    expect(
      isPasswordResetExpired(
        new Date("2026-03-14T00:00:00.000Z"),
        new Date("2026-03-14T00:01:00.000Z"),
      ),
    ).toBe(true);
  });

  it("falls back to manual delivery when mail is not configured", () => {
    expect(resolvePasswordResetDeliveryMode({ emailEnabled: false })).toBe("manual");
  });
});
