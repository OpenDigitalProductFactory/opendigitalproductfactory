import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  findProfessionFamily,
  professionKeyFromRole,
  professionProfileId,
  PROFESSION_REGISTRY,
  resolveProfessionProfile,
  type ProfessionProfileClient,
} from "./resolve-profession-profile";
// Platform profile ID — must match seed-decision-perspective.ts MARK_DPF_PLATFORM_PROFILE_ID
const PLATFORM_PROFILE_ID = "mark-dpf-platform";

// ─── Fake DB client ──────────────────────────────────────────────────────────

function fakeDb(profileId: string): ProfessionProfileClient {
  return {
    decisionPerspectiveProfile: {
      findUnique: async (args) => {
        if (args.where.profileId !== profileId) return null;
        return {
          profileId,
          name: "Test Profession Profile",
          kind: "profession",
          scope: { domains: ["professional-practice"], professionKey: "data-architect", roles: ["build-data-architect", "data-architect"] },
          fallbackProfileId: PLATFORM_PROFILE_ID,
          defaultResolver: { type: "build-studio-owner" },
          autonomyPolicy: {
            allowRecommendation: true,
            allowArbitration: false,
            maxRiskForArbitration: "low",
            minimumConfidenceForRecommendation: 0.55,
            minimumConfidenceForArbitration: 0.9,
          },
          currentVersion: {
            versionId: `${profileId}-v1`,
            versionNumber: 1,
            materialFingerprint: "empty",
            changeSummary: "Initial empty profession profile.",
            createdAt: new Date("2026-06-11T00:00:00.000Z"),
          },
        };
      },
    },
  };
}

function emptyDb(): ProfessionProfileClient {
  return {
    decisionPerspectiveProfile: {
      findUnique: async () => null,
    },
  };
}

// ─── Pure registry helpers ───────────────────────────────────────────────────

describe("findProfessionFamily", () => {
  it("finds a family by canonical agent_name", () => {
    const family = findProfessionFamily("build-data-architect");
    expect(family).not.toBeNull();
    expect(family?.professionKey).toBe("data-architect");
  });

  it("finds a family by prompt-slug alias", () => {
    const family = findProfessionFamily("data-architect");
    expect(family).not.toBeNull();
    expect(family?.professionKey).toBe("data-architect");
  });

  it("returns null for an unregistered identifier", () => {
    expect(findProfessionFamily("totally-unknown-agent")).toBeNull();
  });
});

describe("professionKeyFromRole", () => {
  it("returns the professionKey for a registered agent", () => {
    expect(professionKeyFromRole("build-software-engineer")).toBe("software-engineer");
  });

  it("returns null for an unregistered agent", () => {
    expect(professionKeyFromRole("not-an-agent")).toBeNull();
  });
});

describe("professionProfileId", () => {
  it("produces the deterministic profile id convention", () => {
    expect(professionProfileId("data-architect")).toBe("wsid-data-architect");
    expect(professionProfileId("finance")).toBe("wsid-finance");
  });
});

// ─── DB-driven resolver ──────────────────────────────────────────────────────

describe("resolveProfessionProfile", () => {
  it("resolves a profile by agent_name", async () => {
    const db = fakeDb("wsid-data-architect");
    const result = await resolveProfessionProfile({ db, agentId: "build-data-architect" });
    expect(result).not.toBeNull();
    expect(result?.profileId).toBe("wsid-data-architect");
    expect(result?.kind).toBe("profession");
  });

  it("resolves a profile by prompt-slug alias", async () => {
    const db = fakeDb("wsid-data-architect");
    const result = await resolveProfessionProfile({ db, roleSlug: "data-architect" });
    expect(result).not.toBeNull();
    expect(result?.profileId).toBe("wsid-data-architect");
  });

  it("returns null for an unbound identifier", async () => {
    const db = emptyDb();
    const result = await resolveProfessionProfile({ db, agentId: "totally-unknown-agent" });
    expect(result).toBeNull();
  });

  it("returns null when called with no identifier", async () => {
    const db = emptyDb();
    const result = await resolveProfessionProfile({ db });
    expect(result).toBeNull();
  });

  it("returns null when the DB has no matching profile (corpus not yet seeded)", async () => {
    const db = emptyDb();
    const result = await resolveProfessionProfile({ db, agentId: "marketing-specialist" });
    expect(result).toBeNull();
  });

  it("resolved profile has a fallback chain pointing to the platform profile", async () => {
    const db = fakeDb("wsid-data-architect");
    const result = await resolveProfessionProfile({ db, agentId: "build-data-architect" });
    expect(result?.fallbackProfileId).toBe(PLATFORM_PROFILE_ID);
  });
});

// ─── Coverage lint ───────────────────────────────────────────────────────────

describe("profession registry coverage lint", () => {
  const registryPath = join(__dirname, "../../../../packages/db/data/agent_registry.json");
  const agentRegistryData = JSON.parse(readFileSync(registryPath, "utf-8")) as {
    agents: Array<{ agent_name: string; status?: string }>;
  };

  const activeAgents = agentRegistryData.agents.filter(
    (a) => !a.status || a.status === "active",
  );

  const allRegisteredRoles = new Set(
    PROFESSION_REGISTRY.families.flatMap((f) => f.roles),
  );

  it("every active registry agent maps to exactly one profession family", () => {
    const unmapped = activeAgents.filter((a) => !allRegisteredRoles.has(a.agent_name));
    expect(unmapped, `Unmapped agents: ${unmapped.map((a) => a.agent_name).join(", ")}`).toHaveLength(0);
  });

  it("no agent_name appears in more than one family", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const family of PROFESSION_REGISTRY.families) {
      for (const role of family.roles) {
        if (seen.has(role)) {
          duplicates.push(`${role} in both ${seen.get(role)} and ${family.professionKey}`);
        } else {
          seen.set(role, family.professionKey);
        }
      }
    }
    expect(duplicates, `Duplicate role bindings: ${duplicates.join("; ")}`).toHaveLength(0);
  });

  it("every family has at least one role bound", () => {
    const empty = PROFESSION_REGISTRY.families.filter((f) => f.roles.length === 0);
    expect(empty.map((f) => f.professionKey)).toHaveLength(0);
  });

  it("every family has at least one source entry", () => {
    const noSources = PROFESSION_REGISTRY.families.filter((f) => f.sources.length === 0);
    expect(noSources.map((f) => f.professionKey)).toHaveLength(0);
  });

  it("all source licenseClass values are valid", () => {
    const valid = new Set(["open", "licensed", "org-supplied"]);
    const invalid: string[] = [];
    for (const family of PROFESSION_REGISTRY.families) {
      for (const source of family.sources) {
        if (!valid.has(source.licenseClass)) {
          invalid.push(`${family.professionKey}/${source.name}: ${source.licenseClass}`);
        }
      }
    }
    expect(invalid).toHaveLength(0);
  });
});
