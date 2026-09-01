import { describe, it, expect, vi } from "vitest";

import {
  endpointClearsSensitivity,
  endpointGenuinelyClearsSensitivity,
} from "@/lib/routing/pipeline-v2";
import type { EndpointManifest } from "@/lib/routing/types";
import {
  isRiskOverrideActive,
  parseAcceptedSensitivities,
  RISK_OVERRIDE_STATUS,
} from "./clearance-overrides";

// Only the two clearance arrays matter to the fence; cast a minimal manifest.
function ep(overrides: Partial<EndpointManifest>): EndpointManifest {
  return { sensitivityClearance: [], ...overrides } as EndpointManifest;
}

describe("the fence honors a risk-accepted override as a SEPARATE signal", () => {
  it("clears a sensitivity that is genuinely cleared", () => {
    const e = ep({ sensitivityClearance: ["public", "internal", "confidential"] });
    expect(endpointClearsSensitivity(e, "confidential")).toBe(true);
    expect(endpointGenuinelyClearsSensitivity(e, "confidential")).toBe(true);
  });

  it("blocks a sensitivity that is neither cleared nor risk-accepted", () => {
    const e = ep({ sensitivityClearance: ["public"] });
    expect(endpointClearsSensitivity(e, "confidential")).toBe(false);
  });

  it("clears via an active risk-acceptance when NOT genuinely cleared", () => {
    const e = ep({ sensitivityClearance: ["public"], riskAcceptedClearances: ["confidential"] });
    expect(endpointClearsSensitivity(e, "confidential")).toBe(true);
    // ...but it is NOT genuine — ranking must be able to prefer a safe endpoint.
    expect(endpointGenuinelyClearsSensitivity(e, "confidential")).toBe(false);
  });

  it("does not let a risk-acceptance for one level clear a different level", () => {
    const e = ep({ sensitivityClearance: ["public"], riskAcceptedClearances: ["internal"] });
    expect(endpointClearsSensitivity(e, "confidential")).toBe(false);
  });

  it("treats a missing riskAcceptedClearances as no acceptance", () => {
    const e = ep({ sensitivityClearance: ["public"] });
    expect(e.riskAcceptedClearances).toBeUndefined();
    expect(endpointClearsSensitivity(e, "restricted")).toBe(false);
  });
});

describe("isRiskOverrideActive gates on status AND clock", () => {
  const now = 1_000_000;
  it("is active when status=active and not yet expired", () => {
    expect(isRiskOverrideActive({ status: "active", expiresAt: new Date(now + 1000) }, now)).toBe(true);
  });
  it("is inactive once expired even if status=active", () => {
    expect(isRiskOverrideActive({ status: "active", expiresAt: new Date(now - 1) }, now)).toBe(false);
  });
  it("is inactive when revoked", () => {
    expect(isRiskOverrideActive({ status: RISK_OVERRIDE_STATUS.revoked, expiresAt: new Date(now + 1000) }, now)).toBe(false);
  });
});

describe("parseAcceptedSensitivities coerces stored JSON to known levels", () => {
  it("keeps known levels, drops unknown and non-strings", () => {
    expect(parseAcceptedSensitivities(["confidential", "bogus", 5, "restricted"]))
      .toEqual(["confidential", "restricted"]);
  });
  it("returns [] for a non-array", () => {
    expect(parseAcceptedSensitivities("confidential")).toEqual([]);
    expect(parseAcceptedSensitivities(null)).toEqual([]);
  });
});

describe("loadActiveRiskAcceptedClearances", () => {
  it("unions active override levels per provider and fails closed on DB error", async () => {
    const now = 2_000_000;
    vi.resetModules();
    vi.doMock("@dpf/db", () => ({
      prisma: {
        providerClearanceOverride: {
          findMany: vi.fn().mockResolvedValue([
            { providerId: "anthropic-sub", status: "active", expiresAt: new Date(now + 10_000), acceptedSensitivities: ["confidential"] },
            { providerId: "anthropic-sub", status: "active", expiresAt: new Date(now + 10_000), acceptedSensitivities: ["internal"] },
            // Expired row the query would exclude — re-checked defensively here too.
            { providerId: "codex", status: "active", expiresAt: new Date(now - 1), acceptedSensitivities: ["confidential"] },
          ]),
        },
      },
    }));
    const mod = await import("./clearance-overrides");
    const map = await mod.loadActiveRiskAcceptedClearances(now);
    expect(new Set(map.get("anthropic-sub"))).toEqual(new Set(["confidential", "internal"]));
    expect(map.has("codex")).toBe(false);

    vi.doMock("@dpf/db", () => ({ prisma: { providerClearanceOverride: { findMany: vi.fn().mockRejectedValue(new Error("no table")) } } }));
    vi.resetModules();
    const failMod = await import("./clearance-overrides");
    expect((await failMod.loadActiveRiskAcceptedClearances(now)).size).toBe(0);
    vi.doUnmock("@dpf/db");
    vi.resetModules();
  });
});
