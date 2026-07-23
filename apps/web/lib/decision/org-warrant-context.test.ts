import { describe, expect, it } from "vitest";
import { loadOrgWarrantContext } from "./org-warrant-context";
import { warrantForBacklogItem } from "./warrant-for-item";

function db(opts: {
  industry?: string | null;
  archetypeId?: string | null;
  orgThrows?: boolean;
  noStorefront?: boolean;
}) {
  return {
    organization: {
      findFirst: async () => {
        if (opts.orgThrows) throw new Error("relation does not exist");
        return { industry: opts.industry ?? null };
      },
    },
    ...(opts.noStorefront
      ? {}
      : { storefrontConfig: { findFirst: async () => ({ archetypeId: opts.archetypeId ?? null }) } }),
  };
}

describe("loadOrgWarrantContext", () => {
  it("reads industry + archetype off the org", async () => {
    const ctx = await loadOrgWarrantContext(db({ industry: "healthcare", archetypeId: "clinic" }));
    expect(ctx).toEqual({ industry: "healthcare", jurisdiction: null, archetype: "clinic" });
  });

  it("degrades to a null context when the delegates are absent", async () => {
    expect(await loadOrgWarrantContext({})).toEqual({
      industry: null,
      jurisdiction: null,
      archetype: null,
    });
  });

  it("never throws — a failing read yields a null field, so promote can't fail on it", async () => {
    const ctx = await loadOrgWarrantContext(db({ orgThrows: true, archetypeId: "clinic" }));
    expect(ctx.industry).toBeNull();
    expect(ctx.archetype).toBe("clinic");
  });

  it("tolerates an install with no storefront configured", async () => {
    const ctx = await loadOrgWarrantContext(db({ industry: "software-platform", noStorefront: true }));
    expect(ctx).toEqual({ industry: "software-platform", jurisdiction: null, archetype: null });
  });
});

describe("WWWD context reaches the warrant (the wiring this BI closes)", () => {
  it("an archetype-bearing org escalates evidence to compliance", async () => {
    const context = await loadOrgWarrantContext(db({ industry: "healthcare", archetypeId: "clinic" }));
    const { warrant } = warrantForBacklogItem({
      effortSize: "small",
      workType: "feature",
      text: "add a field to the intake form",
      context,
    });
    expect(warrant.evidenceProfile).toBe("compliance");
    expect(warrant.contextScope.archetype).toBe("clinic");
    expect(warrant.reasons.some((r) => r.startsWith("context:"))).toBe(true);
  });

  it("an unconfigured org is unchanged — no phantom compliance burden", async () => {
    const context = await loadOrgWarrantContext({});
    const bare = warrantForBacklogItem({
      effortSize: "small",
      workType: "feature",
      text: "add a field to the intake form",
    });
    const withCtx = warrantForBacklogItem({
      effortSize: "small",
      workType: "feature",
      text: "add a field to the intake form",
      context,
    });
    expect(withCtx.warrant.evidenceProfile).toBe(bare.warrant.evidenceProfile);
    expect(withCtx.warrant.reasons).toEqual(bare.warrant.reasons);
  });
});
