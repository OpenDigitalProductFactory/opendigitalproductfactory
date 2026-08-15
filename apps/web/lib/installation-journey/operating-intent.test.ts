import { describe, expect, it, vi } from "vitest";

import {
  INSTALLATION_OPERATING_INTENT_KEY,
  loadInstallationOperatingIntent,
  resolveInvestmentFundingAuthority,
} from "./operating-intent";

function dbWith(value: unknown) {
  return {
    platformConfig: {
      findUnique: vi.fn().mockResolvedValue(value === undefined ? null : { value }),
    },
  };
}

const intent = (primaryPurpose: string, status = "confirmed") => ({
  schemaVersion: 1,
  primaryPurpose,
  secondaryPurposes: [],
  relationshipIntents: [],
  evidence: [{ source: "human", claim: "Confirmed by the operator.", observedAt: "2026-08-08T12:00:00.000Z" }],
  confidence: "high",
  confirmation: status === "confirmed"
    ? { status, confirmedAt: "2026-08-08T12:00:00.000Z", confirmedByPrincipalId: "principal-1" }
    : { status },
});

describe("installation operating intent repository", () => {
  it("reads the canonical PlatformConfig key", async () => {
    const db = dbWith(intent("operate-organization"));

    const result = await loadInstallationOperatingIntent(db);

    expect(db.platformConfig.findUnique).toHaveBeenCalledWith({
      where: { key: INSTALLATION_OPERATING_INTENT_KEY },
      select: { value: true },
    });
    expect(result.status).toBe("valid");
  });

  it.each([
    ["missing", dbWith(undefined)],
    ["invalid", dbWith({ schemaVersion: 99 })],
  ])("fails closed for %s configuration", async (status, db) => {
    const loaded = await loadInstallationOperatingIntent(db);
    expect(loaded.status).toBe(status);
    expect(resolveInvestmentFundingAuthority(loaded)).toMatchObject({ allowed: false });
  });

  it("allows only a confirmed organization-operating installation", async () => {
    const production = await loadInstallationOperatingIntent(dbWith(intent("operate-organization")));
    const companion = await loadInstallationOperatingIntent(dbWith(intent("evolve-dpf")));
    const suggested = await loadInstallationOperatingIntent(dbWith(intent("operate-organization", "suggested")));

    expect(resolveInvestmentFundingAuthority(production)).toEqual({ allowed: true });
    expect(resolveInvestmentFundingAuthority(companion)).toMatchObject({
      allowed: false,
      error: "installation_authority_required",
    });
    expect(resolveInvestmentFundingAuthority(suggested)).toMatchObject({ allowed: false });
  });
});
