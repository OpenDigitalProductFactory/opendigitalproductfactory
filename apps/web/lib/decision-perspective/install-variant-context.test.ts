import { describe, expect, it } from "vitest";

import {
  resolveInstallVariantContext,
  type InstallVariantClient,
} from "./install-variant-context";

const EMPTY_REGIONAL = { operatesIn: [], sellsTo: [], employsIn: [], dataResidency: [] };

function fakeDb(opts: {
  category?: string | null; // undefined → storefront returns null
  storefrontThrows?: boolean;
  bc?: Partial<Record<"operatesIn" | "sellsTo" | "employsIn" | "dataResidency", string[]>> | null;
  bcThrows?: boolean;
} = {}): InstallVariantClient {
  return {
    storefrontConfig: {
      findFirst: async () => {
        if (opts.storefrontThrows) throw new Error("no storefront");
        if (opts.category === undefined) return null;
        return { archetype: opts.category === null ? null : { category: opts.category } };
      },
    },
    businessContext: {
      findFirst: async () => {
        if (opts.bcThrows) throw new Error("no business context");
        if (!opts.bc) return null;
        return {
          operatesIn: opts.bc.operatesIn ?? [],
          sellsTo: opts.bc.sellsTo ?? [],
          employsIn: opts.bc.employsIn ?? [],
          dataResidency: opts.bc.dataResidency ?? [],
        };
      },
    },
  };
}

describe("resolveInstallVariantContext", () => {
  it("maps a storefront archetype category to the install archetype", async () => {
    const ctx = await resolveInstallVariantContext(fakeDb({ category: "automotive-services" }));
    expect(ctx).toEqual({ archetype: "automotive-services", regional: EMPTY_REGIONAL });
  });

  it("ignores a category that is not a known PROFESSION_ARCHETYPES slug", async () => {
    const ctx = await resolveInstallVariantContext(fakeDb({ category: "totally-made-up" }));
    expect(ctx.archetype).toBeNull();
  });

  it("returns null archetype + empty regional profile when nothing is configured", async () => {
    const ctx = await resolveInstallVariantContext(fakeDb({}));
    expect(ctx).toEqual({ archetype: null, regional: EMPTY_REGIONAL });
  });

  it("populates the regional profile from the captured compliance scope", async () => {
    const ctx = await resolveInstallVariantContext(
      fakeDb({ category: "retail-goods", bc: { operatesIn: ["us"], sellsTo: ["us", "eu"], employsIn: ["us"] } }),
    );
    expect(ctx.regional).toEqual({
      operatesIn: ["us"],
      sellsTo: ["us", "eu"],
      employsIn: ["us"],
      dataResidency: [],
    });
  });

  it("is resilient per-read: a storefront failure still resolves the regional profile", async () => {
    const ctx = await resolveInstallVariantContext(
      fakeDb({ storefrontThrows: true, bc: { sellsTo: ["eu"] } }),
    );
    expect(ctx.archetype).toBeNull();
    expect(ctx.regional?.sellsTo).toEqual(["eu"]);
  });
});
