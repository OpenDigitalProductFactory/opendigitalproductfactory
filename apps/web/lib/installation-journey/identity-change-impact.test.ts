import { describe, expect, it } from "vitest";

import type { InstallationOperatingIntentV1 } from "@dpf/db/installation-operating-intent";

import {
  normalizeIdentityDeclaration,
  type InstallationIdentityDeclaration,
} from "./identity-presentation";
import {
  buildInstallationIdentityImpact,
  computeIdentityPreviewToken,
} from "./identity-change-impact";

const DEV_INTENT: InstallationOperatingIntentV1 = {
  schemaVersion: 1,
  primaryPurpose: "evolve-dpf",
  secondaryPurposes: [],
  relationshipIntents: [],
  pairedProductionInstallationRef: "dpf-prod-acme",
  evidence: [
    {
      source: "installer",
      claim: "Development workspace detected on host",
      observedAt: "2026-08-01T00:00:00.000Z",
    },
    {
      source: "federation",
      claim: "Found 1 existing federation link(s)",
      observedAt: "2026-08-01T00:00:00.000Z",
    },
    {
      source: "human",
      claim: "The operator confirmed evolve-dpf",
      observedAt: "2026-08-02T00:00:00.000Z",
    },
  ],
  confidence: "high",
  confirmation: {
    status: "confirmed",
    confirmedAt: "2026-08-02T00:00:00.000Z",
    confirmedByPrincipalId: "PRN-1",
  },
};

const DEV_NOW: InstallationIdentityDeclaration = {
  primaryPurpose: "evolve-dpf",
  environmentClass: "development",
  pairedProductionInstallationRef: "dpf-prod-acme",
};

function impact(next: Partial<InstallationIdentityDeclaration>, options?: {
  sourceCapable?: boolean;
  holdsIrreplaceableWork?: boolean;
  current?: InstallationIdentityDeclaration;
}) {
  return buildInstallationIdentityImpact({
    intent: DEV_INTENT,
    current: options?.current ?? DEV_NOW,
    next: { ...(options?.current ?? DEV_NOW), ...next },
    host: { sourceCapable: options?.sourceCapable ?? true },
    holdsIrreplaceableWork: options?.holdsIrreplaceableWork ?? true,
  });
}

describe("normalizeIdentityDeclaration", () => {
  it("turns a blank paired reference into null", () => {
    expect(
      normalizeIdentityDeclaration({ ...DEV_NOW, pairedProductionInstallationRef: "   " })
        .pairedProductionInstallationRef,
    ).toBeNull();
  });

  it("trims a supplied paired reference", () => {
    expect(
      normalizeIdentityDeclaration({ ...DEV_NOW, pairedProductionInstallationRef: " peer " })
        .pairedProductionInstallationRef,
    ).toBe("peer");
  });
});

describe("buildInstallationIdentityImpact", () => {
  it("reports no material change when the identity is unchanged", () => {
    const result = impact({});
    expect(result.material).toBe(false);
    expect(result.changes).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.staleEvidence).toEqual([]);
    expect(result.stanceDeltas.every((d) => d.direction === "unchanged")).toBe(true);
  });

  it("treats a whitespace-only pairing edit as no change", () => {
    expect(impact({ pairedProductionInstallationRef: " dpf-prod-acme " }).material).toBe(false);
  });

  it("names each changed field in plain language", () => {
    const result = impact({ environmentClass: "production", primaryPurpose: "operate-organization" });
    expect(result.material).toBe(true);
    expect(result.changes).toEqual(
      expect.arrayContaining([
        { field: "environmentClass", label: "Environment", from: "Development", to: "Production" },
        {
          field: "primaryPurpose",
          label: "Its main job",
          from: "Safely improve another DPF",
          to: "Run our organization",
        },
      ]),
    );
  });

  it("tightens every brake when development becomes production", () => {
    const result = impact({ environmentClass: "production" });
    const byStance = Object.fromEntries(result.stanceDeltas.map((d) => [d.stance, d]));

    expect(byStance.credentials).toMatchObject({
      from: "Local test keys allowed",
      to: "Operator only",
      direction: "tightens",
    });
    expect(byStance.teardown).toMatchObject({
      from: "Capture work first",
      to: "Never",
      direction: "tightens",
    });
    expect(byStance.peerWrite).toMatchObject({ direction: "loosens", to: "Governed writes" });
    expect(result.loosenedStances.map((d) => d.stance)).toEqual(["peerWrite"]);
  });

  it("loosens teardown and credentials when production becomes development", () => {
    const production: InstallationIdentityDeclaration = {
      primaryPurpose: "operate-organization",
      environmentClass: "production",
      pairedProductionInstallationRef: null,
    };
    const result = buildInstallationIdentityImpact({
      intent: { ...DEV_INTENT, primaryPurpose: "operate-organization" },
      current: production,
      next: { ...production, environmentClass: "development" },
      host: { sourceCapable: true },
      holdsIrreplaceableWork: false,
    });

    const byStance = Object.fromEntries(result.stanceDeltas.map((d) => [d.stance, d]));
    expect(byStance.teardown).toMatchObject({ to: "Allowed", direction: "loosens" });
    expect(byStance.credentials).toMatchObject({ direction: "loosens" });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("An agent may then destroy this installation."),
        "Agents may start handling credentials here without an operator hand-off.",
      ]),
    );
  });

  it("carries the resolver's own rationale for the stance after the change", () => {
    const result = impact({ environmentClass: "production" });
    const teardown = result.stanceDeltas.find((d) => d.stance === "teardown");
    expect(teardown?.rationale).toBe(
      "This is a production installation, so teardown is never an agent action.",
    );
  });

  it("keeps source authority pinned to the host, not the purpose", () => {
    const result = impact({ primaryPurpose: "operate-organization" }, { sourceCapable: false });
    const source = result.stanceDeltas.find((d) => d.stance === "sourceAuthority");
    expect(source).toMatchObject({ from: "Not here", to: "Not here", direction: "unchanged" });
  });

  it("marks only the evidence that derived a changed field as stale", () => {
    const result = impact({ environmentClass: "test" });
    expect(result.staleEvidence).toEqual([
      {
        source: "installer",
        claim: "Development workspace detected on host",
        reason: "This helped guess the identity you are replacing.",
      },
    ]);
  });

  it("never marks a human confirmation stale", () => {
    const result = impact({
      environmentClass: "production",
      primaryPurpose: "operate-organization",
      pairedProductionInstallationRef: null,
    });
    expect(result.staleEvidence.some((note) => note.source === "human")).toBe(false);
    expect(result.staleEvidence.map((note) => note.source).sort()).toEqual([
      "federation",
      "installer",
    ]);
  });

  it("warns when this install becomes the one that can fund", () => {
    const result = impact({ primaryPurpose: "operate-organization" });
    expect(result.warnings).toContain(
      "This installation becomes the one that can make funding decisions.",
    );
  });

  it("warns when the pairing is dropped, without implying a link was revoked", () => {
    const result = impact({ pairedProductionInstallationRef: null });
    const warning = result.warnings.find((w) => w.includes("dpf-prod-acme"));
    expect(warning).toContain("Existing federation links are untouched");
  });
});

describe("computeIdentityPreviewToken", () => {
  it("is stable for the same change", () => {
    const next = { ...DEV_NOW, environmentClass: "production" as const };
    expect(computeIdentityPreviewToken(DEV_NOW, next)).toBe(
      computeIdentityPreviewToken(DEV_NOW, next),
    );
  });

  it("changes when the proposed identity changes", () => {
    const a = computeIdentityPreviewToken(DEV_NOW, { ...DEV_NOW, environmentClass: "production" });
    const b = computeIdentityPreviewToken(DEV_NOW, { ...DEV_NOW, environmentClass: "test" });
    expect(a).not.toBe(b);
  });

  it("changes when the identity in force moves under a pending preview", () => {
    const next = { ...DEV_NOW, environmentClass: "production" as const };
    const a = computeIdentityPreviewToken(DEV_NOW, next);
    const b = computeIdentityPreviewToken({ ...DEV_NOW, primaryPurpose: "grow-channel" }, next);
    expect(a).not.toBe(b);
  });

  it("is the token the impact reports", () => {
    const next = { ...DEV_NOW, environmentClass: "production" as const };
    expect(impact({ environmentClass: "production" }).previewToken).toBe(
      computeIdentityPreviewToken(DEV_NOW, next),
    );
  });
});
