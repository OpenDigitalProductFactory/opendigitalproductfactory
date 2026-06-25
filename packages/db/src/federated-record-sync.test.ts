import { describe, expect, it } from "vitest";
import {
  buildOrganizationCrosswalk,
  reconcileMirror,
  type MirrorState,
} from "./federated-record-sync";

const synced: MirrorState = {
  version: 3,
  syncStatus: "synced",
  canonicalSide: "local",
  payloadHash: "h3",
};

describe("reconcileMirror (B3/B5)", () => {
  it("creates when there is no existing mirror", () => {
    expect(reconcileMirror(null, { fromSide: "local", baseVersion: 0, payloadHash: "h" })).toEqual({
      action: "create",
    });
  });

  it("updates when the canonical side sends a new payload based on the current version", () => {
    expect(reconcileMirror(synced, { fromSide: "local", baseVersion: 3, payloadHash: "h4" })).toEqual({
      action: "update",
      nextVersion: 4,
    });
  });

  it("noops when the payload is unchanged", () => {
    expect(reconcileMirror(synced, { fromSide: "local", baseVersion: 3, payloadHash: "h3" })).toEqual({
      action: "noop",
    });
  });

  it("conflicts when a NON-canonical side tries to mutate", () => {
    expect(reconcileMirror(synced, { fromSide: "peer", baseVersion: 3, payloadHash: "h4" })).toEqual({
      action: "conflict",
      reason: "non-canonical-writer",
    });
  });

  it("conflicts on a stale base version (concurrent change)", () => {
    expect(reconcileMirror(synced, { fromSide: "local", baseVersion: 2, payloadHash: "h4" })).toEqual({
      action: "conflict",
      reason: "stale-base-version",
    });
  });

  it("conflicts when the link is revoked", () => {
    expect(
      reconcileMirror({ ...synced, syncStatus: "revoked" }, { fromSide: "local", baseVersion: 3, payloadHash: "h4" }),
    ).toEqual({ action: "conflict", reason: "link-revoked" });
  });
});

describe("buildOrganizationCrosswalk (B5)", () => {
  it("pairs two explicit org refs", () => {
    expect(buildOrganizationCrosswalk("acc_msp_view", "org_lawfirm")).toEqual({
      recordType: "organization-crosswalk",
      localOrgRef: "acc_msp_view",
      peerOrgRef: "org_lawfirm",
    });
  });

  it("refuses to fabricate a crosswalk from partial identity", () => {
    expect(() => buildOrganizationCrosswalk("", "org_lawfirm")).toThrow();
    expect(() => buildOrganizationCrosswalk("acc", "")).toThrow();
  });
});
