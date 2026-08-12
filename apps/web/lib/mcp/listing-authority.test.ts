import { describe, expect, it, vi } from "vitest";

import {
  isAgentToolListable,
  resolveListingAuthority,
  type ListingAuthority,
} from "./listing-authority";

// A stand-in for tak/agent-grants → isToolAllowedByGrants: allow a tool iff the
// agent holds a grant equal to `<tool>_grant`.
const isAllowed = (name: string, grants: string[]) => grants.includes(`${name}_grant`);

describe("isAgentToolListable", () => {
  it("admits every tool for a non-agent-bound token (token-scope filter is the whole authority)", () => {
    const authority: ListingAuthority = { agentBound: false };
    expect(isAgentToolListable("query_employees", authority, isAllowed)).toBe(true);
    // The grant predicate must not even be consulted for a bare token.
    const spy = vi.fn(() => false);
    isAgentToolListable("anything", authority, spy);
    expect(spy).not.toHaveBeenCalled();
  });

  it("drops every tool under a blanket deny (unresolved agent or clearance shortfall)", () => {
    const authority: ListingAuthority = { agentBound: true, blanketDeny: true };
    expect(isAgentToolListable("query_employees", authority, isAllowed)).toBe(false);
    expect(isAgentToolListable("read_project_file", authority, isAllowed)).toBe(false);
  });

  it("filters by the agent's grants when clearance is satisfied (list/call skew fix)", () => {
    const authority: ListingAuthority = {
      agentBound: true,
      blanketDeny: false,
      agentGrants: ["query_employees_grant"],
    };
    // Granted → listed; un-granted → dropped even though the token scope allowed it.
    expect(isAgentToolListable("query_employees", authority, isAllowed)).toBe(true);
    expect(isAgentToolListable("promote_build", authority, isAllowed)).toBe(false);
  });
});

describe("resolveListingAuthority", () => {
  const deps = (over: Partial<Parameters<typeof resolveListingAuthority>[1]> = {}) => ({
    resolveAgentGrants: vi.fn(async () => ["query_employees_grant"]),
    resolveAgentSensitivity: vi.fn(async () => "internal"),
    resolveHumanClearance: vi.fn(async () => ["public", "internal", "confidential"]),
    ...over,
  });

  it("short-circuits a non-agent-bound token with no DB work", async () => {
    const d = deps();
    const result = await resolveListingAuthority({ agentId: null }, d);
    expect(result).toEqual({ agentBound: false });
    expect(d.resolveAgentGrants).not.toHaveBeenCalled();
    expect(d.resolveAgentSensitivity).not.toHaveBeenCalled();
    expect(d.resolveHumanClearance).not.toHaveBeenCalled();
  });

  it("returns per-grant filtering when clearance covers the agent's sensitivity", async () => {
    const result = await resolveListingAuthority({ agentId: "AGT-1" }, deps());
    expect(result).toEqual({
      agentBound: true,
      blanketDeny: false,
      agentGrants: ["query_employees_grant"],
    });
  });

  it("blanket-denies when the human's clearance excludes the agent's sensitivity", async () => {
    const result = await resolveListingAuthority(
      { agentId: "AGT-1" },
      deps({
        resolveAgentSensitivity: vi.fn(async () => "restricted"),
        resolveHumanClearance: vi.fn(async () => ["public", "internal", "confidential"]),
      }),
    );
    expect(result).toEqual({ agentBound: true, blanketDeny: true });
  });

  it("blanket-denies when the acting agent cannot be resolved (null sensitivity)", async () => {
    const result = await resolveListingAuthority(
      { agentId: "AGT-GONE" },
      deps({ resolveAgentSensitivity: vi.fn(async () => null) }),
    );
    expect(result).toEqual({ agentBound: true, blanketDeny: true });
  });

  it("fails CLOSED for an unknown agent sensitivity label (coerced to restricted)", async () => {
    // An unrecognized stored sensitivity must not widen access: it coerces to
    // "restricted", which a public/internal/confidential clearance cannot cover.
    const result = await resolveListingAuthority(
      { agentId: "AGT-1" },
      deps({
        resolveAgentSensitivity: vi.fn(async () => "top-secret-typo"),
        resolveHumanClearance: vi.fn(async () => ["public", "internal", "confidential"]),
      }),
    );
    expect(result).toEqual({ agentBound: true, blanketDeny: true });
  });
});
