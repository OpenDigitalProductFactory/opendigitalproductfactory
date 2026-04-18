import { describe, expect, it } from "vitest";
import {
  getPlatformFamily,
  PLATFORM_FAMILIES,
} from "@/components/platform/platform-nav";

describe("platform-nav", () => {
  it("defines the top-level platform workflow families", () => {
    expect(PLATFORM_FAMILIES.map((family) => family.label)).toEqual([
      "Overview",
      "AI Operations",
      "Tools & Services",
      "Governance & Audit",
      "Core Admin",
    ]);
  });

  it("maps AI workforce routes to the AI Operations family", () => {
    expect(getPlatformFamily("/platform/ai").key).toBe("ai");
    expect(getPlatformFamily("/platform/ai/providers").key).toBe("ai");
    expect(getPlatformFamily("/platform/ai/operations").key).toBe("ai");
  });

  it("maps tools and service routes to the Tools & Services family", () => {
    expect(getPlatformFamily("/platform/tools").key).toBe("tools");
    expect(getPlatformFamily("/platform/tools/catalog").key).toBe("tools");
    expect(getPlatformFamily("/platform/tools/services").key).toBe("tools");
    expect(getPlatformFamily("/platform/integrations").key).toBe("tools");
    expect(getPlatformFamily("/platform/services").key).toBe("tools");
  });

  it("maps audit routes to the Governance & Audit family", () => {
    expect(getPlatformFamily("/platform/audit").key).toBe("audit");
    expect(getPlatformFamily("/platform/audit/ledger").key).toBe("audit");
    expect(getPlatformFamily("/platform/audit/authority").key).toBe("audit");
  });

  it("maps admin routes to the Core Admin family", () => {
    expect(getPlatformFamily("/admin").key).toBe("admin");
    expect(getPlatformFamily("/admin/settings").key).toBe("admin");
    expect(getPlatformFamily("/admin/platform-development").key).toBe("admin");
  });

  it("keeps the platform root in the Overview family", () => {
    expect(getPlatformFamily("/platform").key).toBe("overview");
  });
});
