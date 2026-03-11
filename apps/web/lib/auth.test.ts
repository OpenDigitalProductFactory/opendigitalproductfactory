import { describe, it, expect } from "vitest";
import { extractPlatformRole } from "./auth-utils.js";

describe("extractPlatformRole", () => {
  it("returns the platform_role from the first group", () => {
    const session = {
      user: { groups: [{ platform_role: "HR-300" }] },
    };
    expect(extractPlatformRole(session as never)).toBe("HR-300");
  });

  it("returns null when user has no groups", () => {
    expect(extractPlatformRole({ user: { groups: [] } } as never)).toBeNull();
  });

  it("returns null when session is null", () => {
    expect(extractPlatformRole(null)).toBeNull();
  });
});
