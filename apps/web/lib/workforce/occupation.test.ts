import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getOccupationByKey,
  resolveOccupationForEmployee,
  resolveOccupationForUser,
  invalidateOccupationCache,
  OCCUPATION_INTERACTIONS,
  type OccupationDbClient,
} from "./occupation";

// A hygienist-shaped OccupationProfile row as Prisma would return it (JSON columns
// are plain objects/arrays).
const HYGIENIST_ROW = {
  occupationKey: "dental-hygienist",
  label: "Dental Hygienist",
  summary: "Runs patient hygiene visits.",
  archetypeCategories: ["healthcare-wellness"],
  archetypeIds: [],
  baseAccessProfile: "workforce-member",
  wsidProfessionFamily: null,
  featureSurface: {
    tileAllowlist: ["today-schedule", "needs-you"],
    navEmphasis: ["/workspace"],
    workspaceHomeOccupationId: null,
  },
  coworkerRoster: [
    { agentSlug: "customer-advisor", interaction: "summon", governanceProfileRef: null },
    // An invalid interaction must be dropped by the parser, not crash resolution.
    { agentSlug: "storefront-advisor", interaction: "bogus", governanceProfileRef: null },
  ],
  onboardingCurriculumId: "occ-intro-dental-hygienist",
  moverCurriculumId: null,
};

function makeDb(overrides: {
  profile?: unknown;
  employeeById?: { position: { occupationKey: string | null } | null } | null;
  employeeByUser?: { position: { occupationKey: string | null } | null } | null;
}) {
  const occupationProfile = {
    findFirst: vi.fn().mockResolvedValue(overrides.profile ?? null),
  };
  const employeeProfile = {
    findUnique: vi.fn().mockResolvedValue(overrides.employeeById ?? null),
    findFirst: vi.fn().mockResolvedValue(overrides.employeeByUser ?? null),
  };
  return { db: { occupationProfile, employeeProfile } as unknown as OccupationDbClient, occupationProfile, employeeProfile };
}

beforeEach(() => {
  invalidateOccupationCache();
});

describe("getOccupationByKey", () => {
  it("resolves and parses a profile row", async () => {
    const { db } = makeDb({ profile: HYGIENIST_ROW });
    const occ = await getOccupationByKey("dental-hygienist", db);
    expect(occ).not.toBeNull();
    expect(occ!.label).toBe("Dental Hygienist");
    expect(occ!.featureSurface.tileAllowlist).toContain("needs-you");
    // The bogus interaction is filtered out; only the valid grant survives.
    expect(occ!.coworkerRoster).toHaveLength(1);
    expect(occ!.coworkerRoster[0].agentSlug).toBe("customer-advisor");
    expect(OCCUPATION_INTERACTIONS).toContain(occ!.coworkerRoster[0].interaction);
  });

  it("returns null for an unknown key", async () => {
    const { db } = makeDb({ profile: null });
    expect(await getOccupationByKey("ghost", db)).toBeNull();
  });

  it("memoizes by key and re-queries after invalidation", async () => {
    const { db, occupationProfile } = makeDb({ profile: HYGIENIST_ROW });
    await getOccupationByKey("dental-hygienist", db);
    await getOccupationByKey("dental-hygienist", db);
    expect(occupationProfile.findFirst).toHaveBeenCalledTimes(1); // second call hit the memo
    invalidateOccupationCache("dental-hygienist");
    await getOccupationByKey("dental-hygienist", db);
    expect(occupationProfile.findFirst).toHaveBeenCalledTimes(2); // seam forces a re-read
  });

  it("caches a miss so unknown keys don't re-query", async () => {
    const { db, occupationProfile } = makeDb({ profile: null });
    await getOccupationByKey("ghost", db);
    await getOccupationByKey("ghost", db);
    expect(occupationProfile.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe("resolveOccupationForEmployee", () => {
  it("walks position -> occupationKey -> profile", async () => {
    const { db } = makeDb({
      profile: HYGIENIST_ROW,
      employeeById: { position: { occupationKey: "dental-hygienist" } },
    });
    const occ = await resolveOccupationForEmployee("emp-1", db);
    expect(occ!.occupationKey).toBe("dental-hygienist");
  });

  it("returns null when the employee has no position", async () => {
    const { db } = makeDb({ employeeById: { position: null } });
    expect(await resolveOccupationForEmployee("emp-1", db)).toBeNull();
  });

  it("returns null when the position has no occupationKey", async () => {
    const { db } = makeDb({ employeeById: { position: { occupationKey: null } } });
    expect(await resolveOccupationForEmployee("emp-1", db)).toBeNull();
  });

  it("returns null when the employee does not exist", async () => {
    const { db } = makeDb({ employeeById: null });
    expect(await resolveOccupationForEmployee("nope", db)).toBeNull();
  });

  it("returns null when the referenced occupation is unknown (honest fallback)", async () => {
    const { db } = makeDb({
      profile: null,
      employeeById: { position: { occupationKey: "retired-occupation" } },
    });
    expect(await resolveOccupationForEmployee("emp-1", db)).toBeNull();
  });
});

describe("resolveOccupationForUser", () => {
  it("resolves via the linked employee profile", async () => {
    const { db } = makeDb({
      profile: HYGIENIST_ROW,
      employeeByUser: { position: { occupationKey: "dental-hygienist" } },
    });
    const occ = await resolveOccupationForUser("user-1", db);
    expect(occ!.label).toBe("Dental Hygienist");
  });

  it("returns null when the user has no employee profile", async () => {
    const { db } = makeDb({ employeeByUser: null });
    expect(await resolveOccupationForUser("user-1", db)).toBeNull();
  });
});
