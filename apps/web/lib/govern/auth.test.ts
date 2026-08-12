import { describe, it, expect } from "vitest";
import { extractPlatformRole, resolveWorkforcePlatformRole } from "./auth-utils.js";

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

describe("resolveWorkforcePlatformRole", () => {
  it("returns null when a sanitized superuser has no cloned platform role", () => {
    expect(resolveWorkforcePlatformRole([
      { platformRole: null },
    ])).toBeNull();
  });

  it("returns the first available platform role when memberships are populated", () => {
    expect(resolveWorkforcePlatformRole([
      { platformRole: null },
      { platformRole: { roleId: "HR-300" } },
    ])).toBe("HR-300");
  });
});
