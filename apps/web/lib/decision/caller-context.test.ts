import { describe, it, expect, vi } from "vitest";
import {
  resolveDecisionCallerContext,
  WWMD_PLATFORM_PROFILE_ID,
  WWWD_ORGANIZATION_PROFILE_ID,
} from "./caller-context";

/** Minimal PrincipalAlias-findFirst mock. `rows` maps aliasType -> aliasValue -> principalId. */
function mockDb(rows: Record<string, Record<string, string>>) {
  return {
    principalAlias: {
      findFirst: vi.fn(async ({ where }: { where: { aliasType: string; aliasValue: string } }) => {
        const principalId = rows[where.aliasType]?.[where.aliasValue];
        return principalId ? { principal: { principalId } } : null;
      }),
    },
  } as unknown as Parameters<typeof resolveDecisionCallerContext>[1];
}

describe("resolveDecisionCallerContext (BI-E1FB2307)", () => {
  it("routes an in-portal coworker to the organization (WWWD) profile", async () => {
    const ctx = await resolveDecisionCallerContext(
      { callingPopulation: "in_platform_coworker", agentId: "build-specialist" },
      mockDb({ agent: { "build-specialist": "PRIN-AGENT-1" } }),
    );
    expect(ctx.governingProfileId).toBe(WWWD_ORGANIZATION_PROFILE_ID);
    expect(ctx.governingProfileKind).toBe("organization");
    expect(ctx.principalId).toBe("PRIN-AGENT-1");
    expect(ctx.resolvedVia).toBe("calling-population");
  });

  it("routes an external coding agent to the platform (WWMD) profile", async () => {
    const ctx = await resolveDecisionCallerContext(
      { callingPopulation: "external_coding_agent", userId: "user-42" },
      mockDb({ user: { "user-42": "PRIN-USER-42" } }),
    );
    expect(ctx.governingProfileId).toBe(WWMD_PLATFORM_PROFILE_ID);
    expect(ctx.governingProfileKind).toBe("platform");
    expect(ctx.principalId).toBe("PRIN-USER-42");
  });

  it("routes a human to the platform (WWMD) profile", async () => {
    const ctx = await resolveDecisionCallerContext(
      { callingPopulation: "human", userId: "user-7" },
      mockDb({ user: { "user-7": "PRIN-7" } }),
    );
    expect(ctx.governingProfileKind).toBe("platform");
    expect(ctx.governingProfileId).toBe(WWMD_PLATFORM_PROFILE_ID);
  });

  it("prefers the agent alias, then falls back to the user alias", async () => {
    const ctx = await resolveDecisionCallerContext(
      { callingPopulation: "in_platform_coworker", agentId: "ghost", userId: "user-9" },
      mockDb({ user: { "user-9": "PRIN-9" } }), // no agent alias for "ghost"
    );
    expect(ctx.principalId).toBe("PRIN-9");
  });

  it("returns a null principal when nothing resolves but still picks a profile", async () => {
    const ctx = await resolveDecisionCallerContext(
      { callingPopulation: "in_platform_coworker", agentId: "unknown" },
      mockDb({}),
    );
    expect(ctx.principalId).toBeNull();
    expect(ctx.governingProfileKind).toBe("organization");
  });

  // BI-HDLEMP-01 — route on decision DOMAIN, not solely caller population.
  // Kernel-ratified route-on-domain (WWMD, DI-58E1256CD8B4): a business-class
  // decision resolves to the org WWWD profile regardless of who calls, and a
  // platform-development decision resolves to WWMD. When decisionDomain is
  // absent the legacy callingPopulation heuristic still governs (backward-compat).
  describe("decisionDomain axis (BI-HDLEMP-01)", () => {
    it("routes an external agent's business decision to the org (WWWD) profile", async () => {
      const ctx = await resolveDecisionCallerContext(
        {
          callingPopulation: "external_coding_agent",
          decisionDomain: "org-business",
          userId: "user-42",
        },
        mockDb({ user: { "user-42": "PRIN-USER-42" } }),
      );
      expect(ctx.governingProfileId).toBe(WWWD_ORGANIZATION_PROFILE_ID);
      expect(ctx.governingProfileKind).toBe("organization");
      expect(ctx.resolvedVia).toBe("decision-domain");
    });

    it("routes an external agent's platform decision to the WWMD profile", async () => {
      const ctx = await resolveDecisionCallerContext(
        {
          callingPopulation: "external_coding_agent",
          decisionDomain: "platform-development",
          userId: "user-42",
        },
        mockDb({ user: { "user-42": "PRIN-USER-42" } }),
      );
      expect(ctx.governingProfileId).toBe(WWMD_PLATFORM_PROFILE_ID);
      expect(ctx.governingProfileKind).toBe("platform");
      expect(ctx.resolvedVia).toBe("decision-domain");
    });

    it("lets domain override population: a coworker's platform decision routes to WWMD", async () => {
      const ctx = await resolveDecisionCallerContext(
        {
          callingPopulation: "in_platform_coworker",
          decisionDomain: "platform-development",
          agentId: "build-specialist",
        },
        mockDb({ agent: { "build-specialist": "PRIN-AGENT-1" } }),
      );
      expect(ctx.governingProfileKind).toBe("platform");
      expect(ctx.governingProfileId).toBe(WWMD_PLATFORM_PROFILE_ID);
      expect(ctx.resolvedVia).toBe("decision-domain");
    });

    it("routes a human contributor's business decision to the org (WWWD) profile", async () => {
      const ctx = await resolveDecisionCallerContext(
        {
          callingPopulation: "human",
          decisionDomain: "org-business",
          userId: "user-7",
        },
        mockDb({ user: { "user-7": "PRIN-7" } }),
      );
      expect(ctx.governingProfileKind).toBe("organization");
      expect(ctx.governingProfileId).toBe(WWWD_ORGANIZATION_PROFILE_ID);
    });

    it("falls back to calling-population routing when decisionDomain is absent", async () => {
      const ctx = await resolveDecisionCallerContext(
        { callingPopulation: "external_coding_agent", userId: "user-42" },
        mockDb({ user: { "user-42": "PRIN-USER-42" } }),
      );
      expect(ctx.governingProfileKind).toBe("platform");
      expect(ctx.resolvedVia).toBe("calling-population");
    });
  });
});
