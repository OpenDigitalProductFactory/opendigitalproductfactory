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
    ]);
  });

  it("does not expose a cross-domain Core Admin teleport tab (EP-NAV-COHERENCE)", () => {
    // Admin is reached from the persistent rail, not a platform secondary-nav tab
    // that swaps the whole context with no way back. The "Core Admin" tab must be
    // gone and no family may point outside the platform route tree.
    expect(PLATFORM_FAMILIES.map((family) => family.label)).not.toContain("Core Admin");
    expect(
      PLATFORM_FAMILIES.every((family) => family.href.startsWith("/platform")),
    ).toBe(true);
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

  it("routes the peer-deployment Connections page (federation-links) to Tools & Services", () => {
    const family = getPlatformFamily("/platform/federation-links");
    expect(family.key).toBe("tools");
    expect(family.subItems.some((item) => item.href === "/platform/federation-links")).toBe(true);
    expect(family.subItems.some((item) => item.label === "Connections")).toBe(true);
  });

  it("disambiguates Identity Federation (SSO) from peer-deployment Connections", () => {
    const identity = getPlatformFamily("/platform/identity");
    expect(identity.subItems.some((item) => item.label === "Identity Federation (SSO)")).toBe(true);
    expect(identity.subItems.some((item) => item.label === "Federation")).toBe(false);
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
    expect(toolsFamily.subItems.some((item) => item.label === "Built-in Tools")).toBe(true);
  });

  it("merges Priority into a single 'Priority & Models' coworker-tuning tab (EP-GOLDEN-TRIANGLE)", () => {
    // The everyday Cost/Quality/Time priority and the advanced per-coworker model
    // guardrails were two competing tabs. They consolidated into ONE surface, so
    // there is no standalone "Priority" tab and no separate "Assignments" tab —
    // just "Priority & Models" pointing at the unified /platform/ai/assignments.
    const aiFamily = getPlatformFamily("/platform/ai/assignments");
    const labels = aiFamily.subItems.map((item) => item.label);

    expect(labels).not.toContain("Priority");
    expect(labels).not.toContain("Assignments");
    expect(labels).toContain("Priority & Models");
    const unified = aiFamily.subItems.find((item) => item.label === "Priority & Models");
    expect(unified?.href).toBe("/platform/ai/assignments");
    // No subItem still points at the now-redirect-only /platform/ai/priority route.
    expect(aiFamily.subItems.some((item) => item.href === "/platform/ai/priority")).toBe(false);
  });

  it("removes redirect-only audit items from the AI family", () => {
    const aiFamily = getPlatformFamily("/platform/ai");

    expect(aiFamily.subItems.some((item) => item.label === "Operations")).toBe(false);
    expect(aiFamily.subItems.some((item) => item.label === "Authority")).toBe(false);
    expect(aiFamily.subItems.some((item) => item.label === "Prompts")).toBe(true);
    expect(aiFamily.subItems.some((item) => item.label === "Providers & Routing")).toBe(true);
  });

  it("maps audit routes to the Governance & Audit family", () => {
    expect(getPlatformFamily("/platform/audit").key).toBe("audit");
    expect(getPlatformFamily("/platform/audit/ledger").key).toBe("audit");
    expect(getPlatformFamily("/platform/audit/authority").key).toBe("audit");
  });

  it("keeps the platform root in the Overview family", () => {
    expect(getPlatformFamily("/platform").key).toBe("overview");
  });

  it("exposes archetype readiness inside the Overview family", () => {
    const overview = getPlatformFamily("/platform/archetype-readiness");

    expect(overview.key).toBe("overview");
    expect(overview.subItems).toContainEqual({
      label: "Archetype Readiness",
      href: "/platform/archetype-readiness",
    });
  });
});
