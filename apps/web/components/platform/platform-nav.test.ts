import { describe, expect, it } from "vitest";
import {
  getPlatformFamily,
  PLATFORM_FAMILIES,
} from "@/components/platform/platform-nav";

describe("platform-nav", () => {
  it("defines the top-level platform workflow families", () => {
    expect(PLATFORM_FAMILIES.map((family) => family.label)).toEqual([
      "Overview",
      "Identity & Access",
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
    expect(getPlatformFamily("/platform/ai/build-studio").key).toBe("ai");
  });

  it("labels the build-studio route as configuration, not the primary studio", () => {
    const aiFamily = getPlatformFamily("/platform/ai/build-studio");

    expect(aiFamily.subItems.some((item) => item.label === "Build Runtime")).toBe(true);
  });

  it("maps tools and service routes to the Tools & Services family", () => {
    expect(getPlatformFamily("/platform/tools").key).toBe("tools");
    expect(getPlatformFamily("/platform/tools/catalog").key).toBe("tools");
    expect(getPlatformFamily("/platform/tools/discovery").key).toBe("tools");
    expect(getPlatformFamily("/platform/tools/services").key).toBe("tools");
    expect(getPlatformFamily("/platform/integrations").key).toBe("tools");
    expect(getPlatformFamily("/platform/services").key).toBe("tools");
  });

  it("renames discovery operations to estate discovery in the tools family", () => {
    const toolsFamily = getPlatformFamily("/platform/tools/discovery");

    expect(toolsFamily.subItems.some((item) => item.label === "Estate Discovery")).toBe(true);
    expect(toolsFamily.subItems.some((item) => item.label === "Discovery Operations")).toBe(
      false,
    );
  });

  it("renames enterprise integrations and targets the integrations index", () => {
    const toolsFamily = getPlatformFamily("/platform/tools/integrations/adp");
    const nativeIntegrations = toolsFamily.subItems.find(
      (item) => item.label === "Native Integrations",
    );

    expect(toolsFamily.key).toBe("tools");
    expect(nativeIntegrations?.href).toBe("/platform/tools/integrations");
    expect(
      toolsFamily.subItems.some((item) => item.label === "Enterprise Integrations"),
    ).toBe(false);
  });

  it("removes redirect-only audit items from the AI family", () => {
    const aiFamily = getPlatformFamily("/platform/ai");

    expect(aiFamily.subItems.some((item) => item.label === "Operations")).toBe(false);
    expect(aiFamily.subItems.some((item) => item.label === "Authority")).toBe(false);
    expect(aiFamily.subItems.some((item) => item.label === "Providers & Routing")).toBe(true);
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
