import { describe, expect, it } from "vitest";

import {
  GUIDANCE_SNAPSHOT_LIFETIME_MS,
  computeGuidanceSnapshotManifest,
  type GuidanceWwwdV1,
} from "@dpf/db/guidance-snapshot-contract";

import { issueGuidanceSnapshot, verifyGuidanceSnapshot } from "./guidance-snapshot";
import { deriveDeviceId, generateInstanceSigningKeypair } from "./instance-identity";

const authority = generateInstanceSigningKeypair();
const authorityDid = deriveDeviceId(authority.signingPublicKey);
const companionDid = deriveDeviceId(generateInstanceSigningKeypair().signingPublicKey);
const now = new Date("2026-11-11T00:00:00.000Z");

function wwwd(): GuidanceWwwdV1 {
  return {
    profile: { profileId: "wwwd-org-1", name: "Operator organization", fallbackProfileId: null, autonomyPolicy: null, defaultResolver: null },
    materials: [{
      materialId: "PM-1", sourceType: "organization-stance", sourceRef: {}, summary: "Prefer reliability.",
      domainClass: "plan-readiness", direction: "support", domains: [], freshness: "current",
      evidenceGrade: "A", confidenceWeight: 0.9, lastValidatedAt: null,
    }],
  };
}

function issue(version = 10) {
  return issueGuidanceSnapshot({ authority, companionInstallationDid: companionDid, wwwd: wwwd(), version, now });
}

const expect_ = { expectedAuthorityDid: authorityDid, selfInstallationDid: companionDid, heldVersion: null, now };

describe("guidance snapshot signing", () => {
  it("issues a snapshot that verifies for its companion", () => {
    const snapshot = issue();
    expect(snapshot.meta.authorityInstallationDid).toBe(authorityDid);
    expect(Date.parse(snapshot.meta.expiresAt) - now.getTime()).toBe(GUIDANCE_SNAPSHOT_LIFETIME_MS);
    expect(verifyGuidanceSnapshot(snapshot, expect_)).toEqual({ ok: true, snapshot });
  });

  it("AC-PAC-02: refuses a bad signature", () => {
    const snapshot = issue();
    const [header, payload] = snapshot.signature.split(".");
    const forged = { ...snapshot, signature: `${header}.${payload}.${Buffer.alloc(64).toString("base64url")}` };
    expect(verifyGuidanceSnapshot(forged, expect_)).toMatchObject({ ok: false, reason: "bad-signature" });
  });

  it("AC-PAC-02: refuses changed content, even with the manifest updated to match", () => {
    const snapshot = issue();
    snapshot.wwwd.materials[0]!.direction = "oppose";
    expect(verifyGuidanceSnapshot(snapshot, expect_)).toMatchObject({ ok: false, reason: "malformed" });

    const resigned = issue();
    resigned.wwwd.materials[0]!.direction = "oppose";
    resigned.manifest = computeGuidanceSnapshotManifest(resigned.wwwd);
    expect(verifyGuidanceSnapshot(resigned, expect_)).toMatchObject({ ok: false, reason: "bad-signature" });
  });

  it("AC-PAC-02: refuses a lower or equal version than the one held", () => {
    expect(verifyGuidanceSnapshot(issue(10), { ...expect_, heldVersion: 10 }))
      .toMatchObject({ ok: false, reason: "version-not-advancing" });
    expect(verifyGuidanceSnapshot(issue(9), { ...expect_, heldVersion: 10 }))
      .toMatchObject({ ok: false, reason: "version-not-advancing" });
  });

  it("refuses a snapshot signed by a key other than the linked authority's", () => {
    const impostor = generateInstanceSigningKeypair();
    const snapshot = issueGuidanceSnapshot({ authority: impostor, companionInstallationDid: companionDid, wwwd: wwwd(), version: 10, now });
    expect(verifyGuidanceSnapshot(snapshot, expect_)).toMatchObject({ ok: false, reason: "authority-mismatch" });
  });

  it("refuses a snapshot issued for another installation", () => {
    const other = deriveDeviceId(generateInstanceSigningKeypair().signingPublicKey);
    expect(verifyGuidanceSnapshot(issue(), { ...expect_, selfInstallationDid: other }))
      .toMatchObject({ ok: false, reason: "not-for-this-installation" });
  });

  it("refuses an expired snapshot", () => {
    const later = new Date(now.getTime() + GUIDANCE_SNAPSHOT_LIFETIME_MS + 1);
    expect(verifyGuidanceSnapshot(issue(), { ...expect_, now: later })).toMatchObject({ ok: false, reason: "expired" });
  });
});
