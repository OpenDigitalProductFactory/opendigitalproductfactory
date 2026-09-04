import { describe, it, expect } from "vitest";

import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";

import {
  ADVERTISED_SCOPES,
  PUBLIC_SCOPES,
  PUBLIC_SCOPE_COPY,
  PUBLIC_SCOPE_TO_GRANTS,
  allKnownGrants,
  coarseScopeForPublicScopes,
  formatScopeParam,
  grantsForPublicScopes,
  isPublicScope,
  parseScopeParam,
  publicScopesGrantingGrant,
  type PublicScope,
} from "./oauth-scope-map";

/**
 * These tests are the reason the two vocabularies are allowed to differ.
 * Without totality the public scope map decays into exactly the pointer-drift
 * this whole work item exists to correct. If one of these fails, fix the MAP —
 * do not relax the test.
 */
describe("public scope map totality", () => {
  const known = allKnownGrants();
  const mapped = PUBLIC_SCOPES.flatMap((s) => PUBLIC_SCOPE_TO_GRANTS[s]);

  it("covers every grant referenced by TOOL_TO_GRANTS", () => {
    const missing = known.filter((g) => !mapped.includes(g));
    expect(
      missing,
      `Unmapped grant(s): ${missing.join(", ")}. A new internal grant must be assigned to exactly one public scope in PUBLIC_SCOPE_TO_GRANTS before it can be reached over OAuth.`,
    ).toEqual([]);
  });

  it("maps every grant to exactly one public scope (it is a partition)", () => {
    const seen = new Map<string, PublicScope[]>();
    for (const s of PUBLIC_SCOPES) {
      for (const g of PUBLIC_SCOPE_TO_GRANTS[s]) {
        seen.set(g, [...(seen.get(g) ?? []), s]);
      }
    }
    const doubled = [...seen.entries()].filter(([, scopes]) => scopes.length > 1);
    expect(
      doubled.map(([g, scopes]) => `${g} -> ${scopes.join("+")}`),
      "A grant in two public scopes makes the consent screen a lie about least privilege.",
    ).toEqual([]);
  });

  it("maps no grant that TOOL_TO_GRANTS does not define", () => {
    const stale = mapped.filter((g) => !known.includes(g));
    expect(
      stale,
      `Mapped grant(s) no longer in TOOL_TO_GRANTS: ${stale.join(", ")}. Remove them from the map.`,
    ).toEqual([]);
  });

  it("the union of the public scopes equals the whole grant vocabulary", () => {
    expect([...new Set(mapped)].sort()).toEqual(known);
  });

  it("keeps the public vocabulary small enough for a human to consent to", () => {
    // Not arbitrary: point 1 of the design rationale. A consent screen nobody
    // reads is worse than none. If this ever needs raising, that is an
    // operator decision (design section 9.4), not a test edit.
    expect(PUBLIC_SCOPES.length).toBeLessThanOrEqual(8);
  });

  it("gives every public scope consent copy", () => {
    for (const s of PUBLIC_SCOPES) {
      expect(PUBLIC_SCOPE_COPY[s]?.title, `${s} has no consent title`).toBeTruthy();
      expect(PUBLIC_SCOPE_COPY[s]?.detail, `${s} has no consent detail`).toBeTruthy();
    }
  });
});

describe("read/write axis", () => {
  it("puts every *_read grant in dpf.read, except the admin surface", () => {
    // admin_read is the ONE deliberate exception: platform administration is a
    // distinct consent decision whether read or written.
    const readGrants = allKnownGrants().filter((g) => g.endsWith("_read") && g !== "admin_read");
    for (const g of readGrants) {
      expect(publicScopesGrantingGrant(g), `${g} should be in dpf.read`).toEqual(["dpf.read"]);
    }
    expect(publicScopesGrantingGrant("admin_read")).toEqual(["dpf.admin"]);
  });

  it("puts no write-shaped grant in dpf.read", () => {
    const writeish = PUBLIC_SCOPE_TO_GRANTS["dpf.read"].filter(
      (g) => g.endsWith("_write") || g.endsWith("_create") || g.endsWith("_execute"),
    );
    expect(writeish, "dpf.read must never carry a mutating grant").toEqual([]);
  });
});

describe("coarse tier derivation", () => {
  it("floors at read for an empty grant set", () => {
    expect(coarseScopeForPublicScopes([])).toBe("read");
  });

  it("is read for dpf.read alone", () => {
    expect(coarseScopeForPublicScopes(["dpf.read"])).toBe("read");
  });

  it("is write for any domain write scope", () => {
    for (const s of ["dpf.work", "dpf.build", "dpf.business", "dpf.operate"] as PublicScope[]) {
      expect(coarseScopeForPublicScopes(["dpf.read", s])).toBe("write");
    }
  });

  it("is admin when dpf.admin is present, regardless of order", () => {
    expect(coarseScopeForPublicScopes(["dpf.admin"])).toBe("admin");
    expect(coarseScopeForPublicScopes(["dpf.read", "dpf.admin", "dpf.work"])).toBe("admin");
    expect(coarseScopeForPublicScopes(["dpf.admin", "dpf.read"])).toBe("admin");
  });
});

describe("scope parameter handling", () => {
  it("parses a space-delimited scope parameter per RFC 6749", () => {
    expect(parseScopeParam("dpf.read dpf.work")).toEqual({
      granted: ["dpf.read", "dpf.work"],
      unknown: [],
    });
  });

  it("separates unknown scopes rather than silently dropping them", () => {
    expect(parseScopeParam("dpf.read files:write")).toEqual({
      granted: ["dpf.read"],
      unknown: ["files:write"],
    });
  });

  it("tolerates empty, null and repeated whitespace", () => {
    expect(parseScopeParam(null)).toEqual({ granted: [], unknown: [] });
    expect(parseScopeParam("")).toEqual({ granted: [], unknown: [] });
    expect(parseScopeParam("  dpf.read   dpf.build  ")).toEqual({
      granted: ["dpf.read", "dpf.build"],
      unknown: [],
    });
  });

  it("deduplicates a repeated scope", () => {
    expect(parseScopeParam("dpf.read dpf.read").granted).toEqual(["dpf.read"]);
  });

  it("round-trips in stable vocabulary order regardless of input order", () => {
    expect(formatScopeParam(["dpf.work", "dpf.read"])).toBe("dpf.read dpf.work");
    expect(formatScopeParam(["dpf.admin", "dpf.build", "dpf.read"])).toBe(
      "dpf.read dpf.build dpf.admin",
    );
  });

  it("recognises exactly the public vocabulary", () => {
    for (const s of PUBLIC_SCOPES) expect(isPublicScope(s)).toBe(true);
    expect(isPublicScope("dpf.everything")).toBe(false);
    expect(isPublicScope("registry_read")).toBe(false);
  });
});

describe("grant expansion", () => {
  it("expands a scope set to sorted, deduplicated grants", () => {
    const grants = grantsForPublicScopes(["dpf.read", "dpf.build"]);
    expect(grants).toEqual([...grants].sort());
    expect(new Set(grants).size).toBe(grants.length);
    expect(grants).toContain("registry_read");
    expect(grants).toContain("build_promote");
  });

  it("grants nothing for an empty scope set", () => {
    expect(grantsForPublicScopes([])).toEqual([]);
  });

  it("expands the whole vocabulary to the whole grant set", () => {
    expect(grantsForPublicScopes(PUBLIC_SCOPES).sort()).toEqual(allKnownGrants());
  });
});

describe("advertised scopes", () => {
  it("advertises read only", () => {
    // The MCP spec tells clients to request everything in scopes_supported
    // when the challenge carries no scope. Advertising a write scope here
    // would make maximal grants the DEFAULT while appearing to implement
    // least privilege. See design section 4.3.1 point 2.
    expect(ADVERTISED_SCOPES).toEqual(["dpf.read"]);
    expect(coarseScopeForPublicScopes([...ADVERTISED_SCOPES])).toBe("read");
  });

  it("advertises only scopes from the public vocabulary", () => {
    for (const s of ADVERTISED_SCOPES) expect(isPublicScope(s)).toBe(true);
  });
});

describe("step-up challenge derivability", () => {
  it("every grant-requiring tool can name the public scopes that would unlock it", () => {
    // The step-up 403 derives its `scope` challenge from the tool's required
    // grants via publicScopesGrantingGrant. If any grant resolved to nothing,
    // buildStepUpChallenge would return null and the OAuth caller would
    // silently fall back to the PAT-shaped 200 — a scope refusal that looks
    // like a dead end again, which is the exact defect this work removes.
    const undecidable: string[] = [];
    for (const [tool, grants] of Object.entries(TOOL_TO_GRANTS)) {
      if (grants.length === 0) continue; // identity-scoped: no scope gate to step up to
      const scopes = new Set(grants.flatMap((g) => publicScopesGrantingGrant(g)));
      if (scopes.size === 0) undecidable.push(tool);
    }
    expect(
      undecidable,
      `Tool(s) whose required grants map to no public scope: ${undecidable.join(", ")}`,
    ).toEqual([]);
  });

  it("resolves a representative grant to exactly one scope", () => {
    expect(publicScopesGrantingGrant("backlog_write")).toEqual(["dpf.work"]);
    expect(publicScopesGrantingGrant("registry_read")).toEqual(["dpf.read"]);
    expect(publicScopesGrantingGrant("build_promote")).toEqual(["dpf.build"]);
    expect(publicScopesGrantingGrant("admin_write")).toEqual(["dpf.admin"]);
  });

  it("resolves an unknown grant to nothing rather than guessing", () => {
    expect(publicScopesGrantingGrant("no_such_grant")).toEqual([]);
  });
});
