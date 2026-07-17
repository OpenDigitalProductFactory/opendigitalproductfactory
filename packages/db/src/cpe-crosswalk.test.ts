import { describe, expect, it } from "vitest";
import {
  buildCpe23,
  cpeToken,
  fetchNvdCpeNames,
  resolveCatalogIdentityCpe,
  type CpeUpsertClient,
} from "./cpe-crosswalk";

describe("cpeToken", () => {
  it("lowercases, underscores whitespace, strips other punctuation, and maps empty to *", () => {
    expect(cpeToken("PostgreSQL Global Development Group")).toBe("postgresql_global_development_group");
    expect(cpeToken("Node.js")).toBe("node.js");
    expect(cpeToken("C++")).toBe("c");
    expect(cpeToken("  ")).toBe("*");
    expect(cpeToken(null)).toBe("*");
  });
});

describe("buildCpe23", () => {
  it("builds a well-formed cpe:2.3 string with * for unspecified attributes", () => {
    expect(buildCpe23({ part: "a", manufacturer: "PostgreSQL", product: "PostgreSQL" })).toBe(
      "cpe:2.3:a:postgresql:postgresql:*:*:*:*:*:*:*:*",
    );
  });
  it("fills version + edition and honors the CPE part", () => {
    expect(
      buildCpe23({ part: "o", manufacturer: "Canonical", product: "Ubuntu", productVersion: "22.04", edition: "LTS" }),
    ).toBe("cpe:2.3:o:canonical:ubuntu:22.04:*:lts:*:*:*:*:*");
    expect(buildCpe23({ part: "h", manufacturer: "Dell", product: "PowerEdge R750" })).toContain("cpe:2.3:h:dell:poweredge_r750:");
  });
  it("defaults an unknown/missing part to 'a'", () => {
    expect(buildCpe23({ part: "x", manufacturer: "Acme", product: "Thing" })).toContain("cpe:2.3:a:acme:thing:");
    expect(buildCpe23({ manufacturer: "Acme", product: "Thing" })).toContain("cpe:2.3:a:acme:thing:");
  });
});

describe("fetchNvdCpeNames", () => {
  const okResponse = (products: unknown) =>
    ({ ok: true, json: async () => ({ products }) }) as unknown as Response;

  it("extracts curated cpeName values from the NVD products payload", async () => {
    const fetcher = (async () =>
      okResponse([
        { cpe: { cpeName: "cpe:2.3:a:postgresql:postgresql:16.2:*:*:*:*:*:*:*" } },
        { cpe: {} },
        { other: true },
      ])) as unknown as typeof fetch;
    expect(await fetchNvdCpeNames("cpe:2.3:a:postgresql:postgresql:*:*:*:*:*:*:*:*", fetcher)).toEqual([
      "cpe:2.3:a:postgresql:postgresql:16.2:*:*:*:*:*:*:*",
    ]);
  });

  it("returns [] on a non-OK response and on a thrown error", async () => {
    const notOk = (async () => ({ ok: false }) as unknown as Response) as unknown as typeof fetch;
    expect(await fetchNvdCpeNames("cpe:2.3:a:x:y:*:*:*:*:*:*:*:*", notOk)).toEqual([]);
    const throws = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect(await fetchNvdCpeNames("cpe:2.3:a:x:y:*:*:*:*:*:*:*:*", throws)).toEqual([]);
  });
});

describe("resolveCatalogIdentityCpe", () => {
  it("persists the deterministic CPE when no fetcher is supplied", async () => {
    const updates: Array<{ where: { id: string }; data: { cpe: string } }> = [];
    const db: CpeUpsertClient = {
      catalogIdentity: {
        update: async (args: unknown) => {
          updates.push(args as { where: { id: string }; data: { cpe: string } });
          return {};
        },
      },
    };
    const cpe = await resolveCatalogIdentityCpe(db, { id: "ci_1", manufacturer: "PostgreSQL", product: "PostgreSQL" });
    expect(cpe).toBe("cpe:2.3:a:postgresql:postgresql:*:*:*:*:*:*:*:*");
    expect(updates).toEqual([{ where: { id: "ci_1" }, data: { cpe } }]);
  });

  it("prefers a curated NVD dictionary name when the fetcher resolves one", async () => {
    const db: CpeUpsertClient = { catalogIdentity: { update: async () => ({}) } };
    const fetcher = (async () =>
      ({
        ok: true,
        json: async () => ({ products: [{ cpe: { cpeName: "cpe:2.3:a:postgresql:postgresql:16.2:*:*:*:*:*:*:*" } }] }),
      }) as unknown as Response) as unknown as typeof fetch;
    const cpe = await resolveCatalogIdentityCpe(
      db,
      { id: "ci_1", manufacturer: "PostgreSQL", product: "PostgreSQL" },
      fetcher,
    );
    expect(cpe).toBe("cpe:2.3:a:postgresql:postgresql:16.2:*:*:*:*:*:*:*");
  });
});
