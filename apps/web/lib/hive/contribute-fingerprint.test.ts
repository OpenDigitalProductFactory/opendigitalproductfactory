import { describe, expect, it, vi } from "vitest";

import { contributeDeviceFingerprint, type FingerprintContributionClient } from "./contribute-fingerprint";

const rule = {
  ruleKey: "estate:ring-security",
  requiredEvidenceFamilies: ["mac_oui"],
  matchExpression: { all: [{ type: "contains" as const, path: "vendor", value: "ring" }] },
  resolvedIdentity: { kind: "device", name: "Ring security camera", vendor: "Ring", deviceClass: "doorbell_camera" },
  taxonomyNodeId: "foundational/building_management/security_and_surveillance",
  identityConfidence: 0.96,
  taxonomyConfidence: 0.96,
};

function client(existing: { id: string } | null = null) {
  const create = vi.fn().mockResolvedValue({ id: "ledger-1" });
  const db: FingerprintContributionClient = {
    platformDevConfig: { findUnique: vi.fn().mockResolvedValue({ deviceFingerprintOptIn: true, hiveContributionsPaused: false, contributionMode: "selective" }) },
    hiveContributionLedger: { findFirst: vi.fn().mockResolvedValue(existing), create },
  };
  return { db, create };
}

describe("contributeDeviceFingerprint", () => {
  it("stores the redacted rule body for curation and queues it once", async () => {
    const { db, create } = client();
    const result = await contributeDeviceFingerprint(rule, { db, contributor: "dpf-test" });

    expect(result).toEqual({ contributed: true, reason: "ready", ledgerId: "ledger-1" });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      contributionType: "device_fingerprint",
      deliveryStatus: "queued",
      resultBundle: expect.objectContaining({ ruleKey: "estate:ring-security", contributor: "dpf-test" }),
    }) });
    expect(JSON.stringify(create.mock.calls[0]?.[0])).not.toMatch(/192\.168|[0-9a-f]{2}(?::[0-9a-f]{2}){5}/i);
  });

  it("coalesces an identical payload hash instead of creating one row per sweep", async () => {
    const { db, create } = client({ id: "ledger-existing" });
    await expect(contributeDeviceFingerprint(rule, { db, contributor: "dpf-test" })).resolves.toEqual({
      contributed: false,
      reason: "already_submitted",
      ledgerId: "ledger-existing",
    });
    expect(create).not.toHaveBeenCalled();
  });
});
