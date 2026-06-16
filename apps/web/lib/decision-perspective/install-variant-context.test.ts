import { describe, expect, it } from "vitest";

import {
  resolveInstallVariantContext,
  type InstallVariantClient,
} from "./install-variant-context";

function fakeDb(category: string | null | undefined, opts: { throws?: boolean } = {}): InstallVariantClient {
  return {
    storefrontConfig: {
      findFirst: async () => {
        if (opts.throws) throw new Error("no storefront");
        if (category === undefined) return null;
        return { archetype: category === null ? null : { category } };
      },
    },
  };
}

describe("resolveInstallVariantContext", () => {
  it("maps a storefront archetype category to the install archetype", async () => {
    const ctx = await resolveInstallVariantContext(fakeDb("automotive-services"));
    expect(ctx).toEqual({ archetype: "automotive-services", regional: {} });
  });

  it("ignores a category that is not a known PROFESSION_ARCHETYPES slug", async () => {
    const ctx = await resolveInstallVariantContext(fakeDb("totally-made-up"));
    expect(ctx.archetype).toBeNull();
  });

  it("returns null archetype + empty regional profile when no storefront config exists", async () => {
    const ctx = await resolveInstallVariantContext(fakeDb(undefined));
    expect(ctx).toEqual({ archetype: null, regional: {} });
  });

  it("fails open to {} on a DB error", async () => {
    const ctx = await resolveInstallVariantContext(fakeDb(null, { throws: true }));
    expect(ctx).toEqual({});
  });
});
