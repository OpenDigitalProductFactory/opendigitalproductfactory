import { describe, expect, it, vi } from "vitest";

import {
  ensureOrgDecisionPerspectiveProfile,
  ORG_PERSPECTIVE_FALLBACK_PROFILE_ID,
  type EnsureOrgDecisionPerspectiveProfileClient,
} from "./ensure-org-decision-perspective-profile";

type Row = Record<string, unknown>;

function makeFakeDb() {
  const profiles: Row[] = [];
  const versions: Row[] = [];

  function upsertBy(
    rows: Row[],
    key: string,
    value: string,
    create: Row,
    update: Row,
  ): Row {
    const found = rows.find((row) => row[key] === value);
    if (found) {
      Object.assign(found, update);
      return found;
    }
    const row = { ...create };
    rows.push(row);
    return row;
  }

  const db: EnsureOrgDecisionPerspectiveProfileClient = {
    decisionPerspectiveProfile: {
      upsert: vi.fn(async (args: any) =>
        upsertBy(profiles, "profileId", args.where.profileId, args.create, args.update),
      ),
      update: vi.fn(async (args: any) => {
        const found = profiles.find((row) => row.profileId === args.where.profileId);
        if (found) Object.assign(found, args.data);
        return found;
      }),
    },
    decisionPerspectiveProfileVersion: {
      upsert: vi.fn(async (args: any) =>
        upsertBy(versions, "versionId", args.where.versionId, args.create, args.update),
      ),
    },
  };

  return { db, profiles, versions };
}

describe("ensureOrgDecisionPerspectiveProfile", () => {
  it("creates the canonical active profile and version before WWWD material writes", async () => {
    const fake = makeFakeDb();

    const result = await ensureOrgDecisionPerspectiveProfile({
      organizationId: "org_rescue",
      organizationName: "Second Chance Animal Rescue",
      db: fake.db,
    });

    expect(result).toEqual({
      profileId: "org-perspective-org_rescue",
      versionId: "org-perspective-org_rescue-v1",
    });
    expect(fake.profiles).toEqual([
      expect.objectContaining({
        profileId: ORG_PERSPECTIVE_FALLBACK_PROFILE_ID,
        fallbackProfileId: null,
        status: "active",
      }),
      expect.objectContaining({
        profileId: result.profileId,
        name: "Second Chance Animal Rescue perspective",
        ownerOrganizationId: "org_rescue",
        fallbackProfileId: ORG_PERSPECTIVE_FALLBACK_PROFILE_ID,
        currentVersionId: result.versionId,
        status: "active",
      }),
    ]);
    // BI-218EC195: the fallback profile is a governing profile in its own
    // right, so it carries a version too — the ledger refuses to record
    // against a profile with no version.
    expect(fake.versions).toEqual([
      expect.objectContaining({
        versionId: `${ORG_PERSPECTIVE_FALLBACK_PROFILE_ID}-v1`,
        profileId: ORG_PERSPECTIVE_FALLBACK_PROFILE_ID,
        versionNumber: 1,
      }),
      expect.objectContaining({
        versionId: result.versionId,
        profileId: result.profileId,
        versionNumber: 1,
      }),
    ]);
    expect(fake.profiles[0]).toEqual(
      expect.objectContaining({ currentVersionId: `${ORG_PERSPECTIVE_FALLBACK_PROFILE_ID}-v1` }),
    );
  });

  it("replays idempotently with the same profile and version", async () => {
    const fake = makeFakeDb();
    const input = {
      organizationId: "org_rescue",
      organizationName: "Second Chance Animal Rescue",
      db: fake.db,
    };

    const first = await ensureOrgDecisionPerspectiveProfile(input);
    const second = await ensureOrgDecisionPerspectiveProfile(input);

    expect(second).toEqual(first);
    expect(fake.profiles).toHaveLength(2);
    expect(fake.versions).toHaveLength(2); // fallback v1 + org v1 (BI-218EC195)
  });
});
