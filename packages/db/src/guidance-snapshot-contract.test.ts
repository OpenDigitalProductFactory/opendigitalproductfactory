import { describe, expect, it } from "vitest";

import {
  GUIDANCE_SNAPSHOT_LIFETIME_MS,
  computeGuidanceSnapshotManifest,
  guidanceSnapshotSigningPayload,
  judgeGuidanceSnapshotFreshness,
  validateGuidanceSnapshotV1,
  type GuidanceSnapshotV1,
  type GuidanceWwwdV1,
} from "./guidance-snapshot-contract";

const AUTHORITY = `did_${"a".repeat(64)}`;
const COMPANION = `did_${"c".repeat(64)}`;

function wwwd(): GuidanceWwwdV1 {
  return {
    profile: { profileId: "wwwd-org-1", name: "Operator organization", fallbackProfileId: null, autonomyPolicy: null, defaultResolver: null },
    materials: [
      {
        materialId: "PM-1",
        sourceType: "organization-stance",
        sourceRef: { page: "how-we-decide" },
        summary: "Prefer reliability over new capability.",
        domainClass: "plan-readiness",
        direction: "support",
        domains: ["reliability"],
        freshness: "current",
        evidenceGrade: "A",
        confidenceWeight: 0.9,
        lastValidatedAt: "2026-11-01T00:00:00.000Z",
      },
    ],
  };
}

function snapshot(overrides: Partial<GuidanceSnapshotV1["meta"]> = {}): GuidanceSnapshotV1 {
  const content = wwwd();
  return {
    specVersion: "dpf.guidance-snapshot/1",
    meta: {
      authorityInstallationDid: AUTHORITY,
      authoritySigningPublicKey: "MCowBQYDK2VwAyEA" + "A".repeat(43) + "=",
      companionInstallationDid: COMPANION,
      version: 1_762_840_000_000,
      issuedAt: "2026-11-11T00:00:00.000Z",
      expiresAt: "2026-11-25T00:00:00.000Z",
      ...overrides,
    },
    wwwd: content,
    manifest: computeGuidanceSnapshotManifest(content),
    signature: "e30.e30.c2ln",
  };
}

describe("guidance snapshot contract", () => {
  it("accepts a well-formed snapshot", () => {
    expect(validateGuidanceSnapshotV1(snapshot())).toEqual([]);
  });

  it("reports a changed content hash: the manifest no longer matches what was carried", () => {
    const record = snapshot();
    record.wwwd.materials[0]!.direction = "oppose";
    expect(validateGuidanceSnapshotV1(record)).toContain("manifest:mismatch:wwwd/materials");
  });

  it("refuses an unknown spec version and malformed DIDs", () => {
    const record = { ...snapshot(), specVersion: "dpf.guidance-snapshot/9" };
    expect(validateGuidanceSnapshotV1(record)).toContain("specVersion:unsupported");
    expect(validateGuidanceSnapshotV1(snapshot({ companionInstallationDid: "not-a-did" })))
      .toContain("meta.companionInstallationDid:invalid");
  });

  it("refuses a snapshot whose expiry does not follow its issue time", () => {
    expect(validateGuidanceSnapshotV1(snapshot({ expiresAt: "2026-11-10T00:00:00.000Z" })))
      .toContain("meta.expiresAt:not-after-issuedAt");
  });

  it("signs meta and manifest, not the content itself, in one canonical form", () => {
    const record = snapshot();
    const reordered = { ...record, meta: Object.fromEntries(Object.entries(record.meta).reverse()) as GuidanceSnapshotV1["meta"] };
    expect(guidanceSnapshotSigningPayload(record)).toBe(guidanceSnapshotSigningPayload(reordered));
    expect(JSON.parse(guidanceSnapshotSigningPayload(record))).toEqual({ manifest: record.manifest, meta: record.meta });
  });

  it("defaults the lifetime to fourteen days", () => {
    expect(GUIDANCE_SNAPSHOT_LIFETIME_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });
});

describe("judgeGuidanceSnapshotFreshness", () => {
  const now = new Date("2026-11-12T00:00:00.000Z");

  it("accepts the first snapshot and a newer version", () => {
    expect(judgeGuidanceSnapshotFreshness({ snapshot: snapshot(), heldVersion: null, now })).toEqual({ ok: true });
    expect(judgeGuidanceSnapshotFreshness({ snapshot: snapshot(), heldVersion: 5, now })).toEqual({ ok: true });
  });

  it("refuses a version that does not advance past the one held", () => {
    const record = snapshot();
    expect(judgeGuidanceSnapshotFreshness({ snapshot: record, heldVersion: record.meta.version, now }))
      .toEqual({ ok: false, reason: "version-not-advancing" });
    expect(judgeGuidanceSnapshotFreshness({ snapshot: record, heldVersion: record.meta.version + 1, now }))
      .toEqual({ ok: false, reason: "version-not-advancing" });
  });

  it("refuses an expired snapshot", () => {
    expect(judgeGuidanceSnapshotFreshness({
      snapshot: snapshot(), heldVersion: null, now: new Date("2026-11-25T00:00:00.001Z"),
    })).toEqual({ ok: false, reason: "expired" });
  });
});
