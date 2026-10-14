import { describe, expect, it, vi } from "vitest";
import { platformUpdatePack } from "./platform-update-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const ALL_TOOLS = ["apply_platform_update", "summarize_upgrade_impact", "preview_runtime_capability_reconciliation", "reconcile_runtime_capabilities"] as const;

describe("platform-update pack", () => {
  it("keeps runtime preview read-only and reconciliation under existing administrator grants", () => {
    const preview = platformUpdatePack.definitions.find(d => d.name === "preview_runtime_capability_reconciliation")!;
    const apply = platformUpdatePack.definitions.find(d => d.name === "reconcile_runtime_capabilities")!;
    expect(preview.sideEffect).toBe(false); expect(preview.requiredCapability).toBe("manage_platform");
    expect(apply.sideEffect).toBe(true); expect(apply.requiredCapability).toBe("manage_platform");
    expect(apply.consequence).toBe("authority"); expect(apply.consequenceScope).toBe("platform");
    expect(isToolAllowedByGrants(preview.name, ["admin_read"])).toBe(true);
    expect(isToolAllowedByGrants(apply.name, ["admin_read"])).toBe(false);
    expect(isToolAllowedByGrants(apply.name, ["admin_write"])).toBe(true);
  });

  it("delegates explicit runtime intent without forwarding a forged actor or mode", async () => {
    const request = vi.fn(async () => ({ status: "succeeded" }));
    vi.doMock("@/lib/actions/runtime-capabilities", () => ({ requestRuntimeCapabilityTransition: request }));
    const intent = { observedHost: {}, observedDatabaseStates: {}, desiredHostEnabledKeys: ["runtime:core"], desiredDatabaseStates: {}, touchedKeys: [] };
    const result = await platformUpdatePack.handlers.reconcile_runtime_capabilities({ transitionId: "RCT-1", reconciliation: intent, requestedById: "forged-user", mode: "transition" }, "verified-user");
    expect(request).toHaveBeenCalledWith({ transitionId: "RCT-1", desiredKeys: ["runtime:core"], mode: "reconciliation", reconciliation: intent });
    expect(result.success).toBe(true);
    vi.doUnmock("@/lib/actions/runtime-capabilities");
  });
  it("registers both platform-update tools with handlers", () => {
    const names = platformUpdatePack.definitions.map((d) => d.name).sort();
    expect(names).toEqual([...ALL_TOOLS].sort());
    for (const name of ALL_TOOLS) {
      expect(platformUpdatePack.handlers[name]).toBeTypeOf("function");
    }
  });

  it("marks apply as manage_platform/side-effecting and the preview as read-only view_operations", () => {
    const apply = platformUpdatePack.definitions.find((d) => d.name === "apply_platform_update")!;
    expect(apply.requiredCapability).toBe("manage_platform");
    expect(apply.sideEffect).toBe(true);

    const preview = platformUpdatePack.definitions.find((d) => d.name === "summarize_upgrade_impact")!;
    expect(preview.requiredCapability).toBe("view_operations");
    expect(preview.sideEffect).toBe(false);
  });

  it("mirrors the admin_write / admin_read grants and gates against the gating source", () => {
    expect(platformUpdatePack.grants.apply_platform_update).toEqual(["admin_write"]);
    expect(isToolAllowedByGrants("apply_platform_update", ["admin_write"])).toBe(true);
    expect(isToolAllowedByGrants("apply_platform_update", ["admin_read"])).toBe(false);

    expect(platformUpdatePack.grants.summarize_upgrade_impact).toEqual(["admin_read"]);
    expect(isToolAllowedByGrants("summarize_upgrade_impact", ["admin_read"])).toBe(true);
    expect(isToolAllowedByGrants("summarize_upgrade_impact", ["registry_read"])).toBe(false);
  });

  it("keeps every tool description provenance-free", () => {
    for (const def of platformUpdatePack.definitions) {
      expect(def.description).not.toMatch(/BI-|Phase \d|apps\/web|EP-/);
    }
  });

  it("apply_platform_update surfaces a clean merge from the platform-dev-config action", async () => {
    vi.resetModules();
    vi.doMock("@/lib/actions/platform-dev-config", () => ({
      applyPlatformUpdate: vi.fn(async () => ({
        kind: "clean-merge",
        message: "Merged cleanly.",
        filesUpdated: 12,
        version: "v9.9.9",
      })),
    }));
    const { platformUpdatePack: freshPack } = await import("./platform-update-pack");
    const res = await freshPack.handlers.apply_platform_update({}, "user-1");
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ clean: true, filesUpdated: 12, version: "v9.9.9" });
    vi.doUnmock("@/lib/actions/platform-dev-config");
    vi.resetModules();
  });

  it("apply_platform_update surfaces the retired-engine refusal", async () => {
    vi.resetModules();
    vi.doMock("@/lib/actions/platform-dev-config", () => ({
      applyPlatformUpdate: vi.fn(async () => ({
        kind: "engine-retired",
        message: "The /workspace merge engine is retired.",
      })),
    }));
    const { platformUpdatePack: freshPack } = await import("./platform-update-pack");
    const res = await freshPack.handlers.apply_platform_update({}, "user-1");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Engine retired — use Self-Upgrade");
    vi.doUnmock("@/lib/actions/platform-dev-config");
    vi.resetModules();
  });

  it("summarize_upgrade_impact returns the phrased headline envelope", async () => {
    vi.resetModules();
    vi.doMock("@/lib/self-upgrade/impact", () => ({
      summarizeUpgradeImpact: vi.fn(async () => ({
        ok: true,
        summary: {
          counts: { total: 3 },
          phrased: { headline: "3 commits, one touches your customizations." },
        },
      })),
    }));
    const { platformUpdatePack: freshPack } = await import("./platform-update-pack");
    const res = await freshPack.handlers.summarize_upgrade_impact({ topN: 5 }, "user-1");
    expect(res.success).toBe(true);
    expect(res.message).toBe("3 commits, one touches your customizations.");
    vi.doUnmock("@/lib/self-upgrade/impact");
    vi.resetModules();
  });

  it("summarize_upgrade_impact passes a not-ok result through as an advisory success", async () => {
    vi.resetModules();
    vi.doMock("@/lib/self-upgrade/impact", () => ({
      summarizeUpgradeImpact: vi.fn(async () => ({
        ok: false,
        reason: "no-marker",
        detail: "No lineage marker yet.",
      })),
    }));
    const { platformUpdatePack: freshPack } = await import("./platform-update-pack");
    const res = await freshPack.handlers.summarize_upgrade_impact({}, "user-1");
    expect(res.success).toBe(true);
    expect(res.message).toBe("No lineage marker yet.");
    expect(res.data).toMatchObject({ ok: false, reason: "no-marker" });
    vi.doUnmock("@/lib/self-upgrade/impact");
    vi.resetModules();
  });
});
