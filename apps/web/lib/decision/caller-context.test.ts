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
});
