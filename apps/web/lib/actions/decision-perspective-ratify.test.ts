import { describe, expect, it, vi } from "vitest";

import { ratifyPolicyVersionForPrincipal, type RatifyPolicyVersionClient } from "./decision-perspective-ratify";

function client(over: {
  profile?: Record<string, unknown> | null;
  version?: Record<string, unknown> | null;
  updateCount?: number;
} = {}): RatifyPolicyVersionClient & { updateMany: ReturnType<typeof vi.fn> } {
  const updateMany = vi.fn().mockResolvedValue({ count: over.updateCount ?? 1 });
  return {
    updateMany,
    decisionPerspectiveProfile: {
      findUnique: vi.fn().mockResolvedValue(
        over.profile === undefined
          ? { profileId: "mark-dpf-platform", kind: "platform", currentVersionId: "mark-dpf-platform-v1", status: "active" }
          : over.profile,
      ),
    },
    decisionPerspectiveProfileVersion: {
      findUnique: vi.fn().mockResolvedValue(
        over.version === undefined ? { versionId: "mark-dpf-platform-v1", promotedByPrincipalId: null } : over.version,
      ),
      updateMany,
    },
  };
}

describe("ratifyPolicyVersionForPrincipal (BI-9C384562)", () => {
  it("records the signed-in human as promoter of the current platform policy version", async () => {
    const db = client();
    const result = await ratifyPolicyVersionForPrincipal({ db, profileId: "mark-dpf-platform", principalId: "principal-mark" });
    expect(result).toEqual({
      ok: true,
      data: { profileId: "mark-dpf-platform", versionId: "mark-dpf-platform-v1", promotedByPrincipalId: "principal-mark", alreadyRatified: false },
    });
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { versionId: "mark-dpf-platform-v1", promotedByPrincipalId: null },
      data: { promotedByPrincipalId: "principal-mark" },
    });
  });

  it("never overwrites an existing ratifier", async () => {
    const db = client({ version: { versionId: "mark-dpf-platform-v1", promotedByPrincipalId: "principal-first" } });
    const result = await ratifyPolicyVersionForPrincipal({ db, profileId: "mark-dpf-platform", principalId: "principal-mark" });
    expect(result).toMatchObject({ ok: true, data: { alreadyRatified: true, promotedByPrincipalId: "principal-first" } });
    expect(db.updateMany).not.toHaveBeenCalled();
  });

  it("loses a race honestly instead of double-signing", async () => {
    const db = client({ updateCount: 0 });
    const result = await ratifyPolicyVersionForPrincipal({ db, profileId: "mark-dpf-platform", principalId: "principal-mark" });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("ratified this version first") });
  });

  it("refuses profession profiles and inactive or versionless profiles", async () => {
    expect(await ratifyPolicyVersionForPrincipal({
      db: client({ profile: { profileId: "wsid-finance", kind: "profession", currentVersionId: "v", status: "active" } }),
      profileId: "wsid-finance", principalId: "p",
    })).toMatchObject({ ok: false, error: expect.stringContaining("craft page") });
    expect(await ratifyPolicyVersionForPrincipal({
      db: client({ profile: { profileId: "x", kind: "platform", currentVersionId: null, status: "active" } }),
      profileId: "x", principalId: "p",
    })).toMatchObject({ ok: false, error: expect.stringContaining("no current version") });
    expect(await ratifyPolicyVersionForPrincipal({ db: client({ profile: null }), profileId: "x", principalId: "p" }))
      .toMatchObject({ ok: false });
  });
});
