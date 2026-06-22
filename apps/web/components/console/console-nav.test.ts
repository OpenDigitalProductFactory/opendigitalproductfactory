import { describe, expect, it } from "vitest";

import { CONSOLE_FAMILIES, getConsoleFamily } from "./console-nav";

describe("console-nav (one operator console)", () => {
  it("composes the platform families plus a single Administration family", () => {
    expect(CONSOLE_FAMILIES.map((f) => f.label)).toEqual([
      "Overview",
      "Identity & Access",
      "AI Operations",
      "Tools & Services",
      "Governance & Audit",
      "Runtime & Releases",
      "Administration",
    ]);
  });

  it("resolves runtime/release ops paths to the Runtime & Releases family", () => {
    expect(getConsoleFamily("/ops/self-upgrade").key).toBe("runtime-releases");
    expect(getConsoleFamily("/ops/promotions").key).toBe("runtime-releases");
    expect(getConsoleFamily("/ops/changes").key).toBe("runtime-releases");
    expect(getConsoleFamily("/ops/dev-loop").key).toBe("runtime-releases");
  });

  it("resolves admin paths to the Administration family (no separate tab row)", () => {
    expect(getConsoleFamily("/admin").key).toBe("administration");
    expect(getConsoleFamily("/admin/settings").key).toBe("administration");
    expect(getConsoleFamily("/admin/platform-development").key).toBe("administration");
  });

  it("resolves platform paths to their platform family", () => {
    expect(getConsoleFamily("/platform").key).toBe("overview");
    expect(getConsoleFamily("/platform/ai").key).toBe("ai");
    expect(getConsoleFamily("/platform/ai/providers").key).toBe("ai");
    expect(getConsoleFamily("/platform/tools/catalog").key).toBe("tools");
    expect(getConsoleFamily("/platform/identity").key).toBe("identity");
    expect(getConsoleFamily("/platform/audit/ledger").key).toBe("audit");
  });

  it("folds the admin areas into the Administration sub-nav", () => {
    const admin = CONSOLE_FAMILIES.find((f) => f.key === "administration");
    const hrefs = (admin?.subItems ?? []).map((s) => s.href);
    expect(hrefs).toContain("/admin"); // Users & Roles
    expect(hrefs).toContain("/admin/settings");
    expect(hrefs).toContain("/admin/platform-development");
  });

  it("keeps every console family inside the platform, admin, or runtime-ops tree", () => {
    expect(
      CONSOLE_FAMILIES.every(
        (f) =>
          f.href.startsWith("/platform") ||
          f.href.startsWith("/admin") ||
          f.href.startsWith("/ops/"),
      ),
    ).toBe(true);
  });
});
