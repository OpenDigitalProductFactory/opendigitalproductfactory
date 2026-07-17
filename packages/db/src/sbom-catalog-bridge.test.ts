import { describe, expect, it } from "vitest";
import {
  bomComponentToCatalogIdentity,
  parsePurl,
  upsertIdentitiesForComponents,
  upsertIdentityForComponent,
  type SbomBridgeClient,
} from "./sbom-catalog-bridge";

describe("parsePurl", () => {
  it("parses type / name / version", () => {
    expect(parsePurl("pkg:npm/lodash@4.17.21")).toEqual({ type: "npm", namespace: null, name: "lodash", version: "4.17.21" });
  });
  it("does not mistake an npm scope for a version", () => {
    expect(parsePurl("pkg:npm/@babel/core@7.0.0")).toEqual({ type: "npm", namespace: "@babel", name: "core", version: "7.0.0" });
    expect(parsePurl("pkg:npm/@babel/core")).toEqual({ type: "npm", namespace: "@babel", name: "core", version: null });
  });
  it("parses a maven namespace and strips qualifiers", () => {
    expect(parsePurl("pkg:maven/org.apache.logging.log4j/log4j-core@2.14.1?type=jar")).toEqual({
      type: "maven",
      namespace: "org.apache.logging.log4j",
      name: "log4j-core",
      version: "2.14.1",
    });
  });
  it("returns null for non-PURL input", () => {
    expect(parsePurl("lodash@4")).toBeNull();
    expect(parsePurl(null)).toBeNull();
  });
});

describe("bomComponentToCatalogIdentity", () => {
  it("derives from the PURL (namespace→manufacturer, name→product, version)", () => {
    expect(bomComponentToCatalogIdentity({ name: "core", packageUrl: "pkg:npm/@babel/core@7.0.0" })).toEqual({
      identityKey: "a:babel:core:7-0-0", // slug() strips the leading @ from the namespace
      part: "a",
      manufacturer: "@babel",
      product: "core",
      productVersion: "7.0.0",
    });
  });
  it("falls back to supplierName / component name when there is no PURL", () => {
    expect(bomComponentToCatalogIdentity({ name: "log4j-core", version: "2.14.1", supplierName: "Apache" })).toEqual({
      identityKey: "a:apache:log4j-core:2-14-1",
      part: "a",
      manufacturer: "Apache",
      product: "log4j-core",
      productVersion: "2.14.1",
    });
  });
  it("returns null when there is no resolvable product name", () => {
    expect(bomComponentToCatalogIdentity({ name: "" })).toBeNull();
  });
});

describe("upsertIdentityForComponent", () => {
  it("upserts a source='sbom' CatalogIdentity keyed on identityKey", async () => {
    const upserts: Array<{ where: { identityKey: string }; create: { source: string; product: string } }> = [];
    const db: SbomBridgeClient = {
      catalogIdentity: {
        upsert: async (args: unknown) => {
          upserts.push(args as { where: { identityKey: string }; create: { source: string; product: string } });
          return { id: "ci_1" };
        },
      },
    };
    const key = await upsertIdentityForComponent(db, { name: "lodash", packageUrl: "pkg:npm/lodash@4.17.21" });
    expect(key).toBe("a:npm:lodash:4-17-21");
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.where.identityKey).toBe("a:npm:lodash:4-17-21");
    expect(upserts[0]!.create.source).toBe("sbom");
    expect(upserts[0]!.create.product).toBe("lodash");
  });

  it("counts only resolvable components in a batch", async () => {
    let calls = 0;
    const db: SbomBridgeClient = {
      catalogIdentity: { upsert: async () => ((calls += 1), { id: `ci_${calls}` }) },
    };
    const written = await upsertIdentitiesForComponents(db, [
      { name: "lodash", packageUrl: "pkg:npm/lodash@4.17.21" },
      { name: "" }, // unresolvable → skipped
      { name: "requests", packageUrl: "pkg:pypi/requests@2.28.0" },
    ]);
    expect(written).toBe(2);
    expect(calls).toBe(2);
  });
});
