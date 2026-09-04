import { describe, expect, it } from "vitest";

import { createBomComponentKey, createNpmPackageUrl } from "./bom-component-key";

describe("createBomComponentKey", () => {
  it("is the stable identity contract shared by every BOM ingestion path", () => {
    expect(createBomComponentKey({
      componentType: "library",
      ecosystem: "npm",
      name: "@dpf/db",
      version: "0.1.0",
      packageUrl: "pkg:npm/%40dpf/db@0.1.0",
    })).toBe("f3127c415ac2d6b04d95865e");
  });

  it("keeps component types distinct", () => {
    const common = {
      ecosystem: "npm",
      name: "gpt-5.4",
      version: "2026-05",
      packageUrl: null,
    } as const;

    expect(createBomComponentKey({ ...common, componentType: "model" }))
      .not.toBe(createBomComponentKey({ ...common, componentType: "library" }));
  });
});

describe("createNpmPackageUrl", () => {
  it("encodes scoped and unscoped npm package names", () => {
    expect(createNpmPackageUrl("@dpf/db", "0.1.0")).toBe("pkg:npm/%40dpf/db@0.1.0");
    expect(createNpmPackageUrl("next", "16.2.6")).toBe("pkg:npm/next@16.2.6");
  });
});
