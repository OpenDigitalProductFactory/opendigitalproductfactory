import { describe, expect, it } from "vitest";

import {
  INSTALLATION_OPERATING_PURPOSES,
  parseInstallationOperatingIntent,
} from "./installation-operating-intent";

const confirmedIntent = {
  schemaVersion: 1,
  primaryPurpose: "operate-organization",
  secondaryPurposes: ["participate-community"],
  relationshipIntents: ["same-organization"],
  evidence: [
    {
      source: "human",
      claim: "The operator confirmed this installation runs the organization.",
      observedAt: "2026-08-08T12:00:00.000Z",
    },
  ],
  confidence: "high",
  confirmation: {
    status: "confirmed",
    confirmedAt: "2026-08-08T12:00:00.000Z",
    confirmedByPrincipalId: "principal-1",
  },
};

describe("parseInstallationOperatingIntent", () => {
  it("keeps the purpose vocabulary closed", () => {
    expect(INSTALLATION_OPERATING_PURPOSES).toEqual([
      "operate-organization",
      "evolve-dpf",
      "deliver-managed-services",
      "grow-channel",
      "participate-community",
    ]);
  });

  it("accepts a confirmed v1 intent", () => {
    expect(parseInstallationOperatingIntent(confirmedIntent)).toEqual({
      ok: true,
      value: confirmedIntent,
    });
  });

  it.each([
    ["unknown schema", { ...confirmedIntent, schemaVersion: 2 }],
    ["unknown purpose", { ...confirmedIntent, primaryPurpose: "production" }],
    ["duplicate purpose", { ...confirmedIntent, secondaryPurposes: ["operate-organization"] }],
    ["unknown relationship", { ...confirmedIntent, relationshipIntents: ["trusted-peer"] }],
    ["incomplete confirmation", { ...confirmedIntent, confirmation: { status: "confirmed" } }],
  ])("rejects %s", (_label, input) => {
    expect(parseInstallationOperatingIntent(input)).toMatchObject({ ok: false });
  });
});
