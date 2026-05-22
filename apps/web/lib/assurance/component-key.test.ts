import { describe, expect, it } from "vitest";
import { createComponentKey, createNpmPackageUrl } from "./component-key";

describe("createComponentKey", () => {
  it("creates stable keys for package components", () => {
    const input = {
      componentType: "library",
      ecosystem: "npm",
      name: "@dpf/db",
      version: "0.1.0",
      packageUrl: "pkg:npm/%40dpf/db@0.1.0",
    } as const;

    expect(createComponentKey(input)).toBe(createComponentKey(input));
    expect(createComponentKey(input)).toMatch(/^[a-f0-9]{24}$/);
  });

  it("creates different keys for model components", () => {
    const left = createComponentKey({
      componentType: "model",
      ecosystem: "ai-model",
      name: "gpt-5.4",
      version: "2026-05",
      packageUrl: null,
    });
    const right = createComponentKey({
      componentType: "library",
      ecosystem: "npm",
      name: "gpt-5.4",
      version: "2026-05",
      packageUrl: null,
    });

    expect(left).not.toBe(right);
  });
});

describe("createNpmPackageUrl", () => {
  it("encodes scoped npm package names", () => {
    expect(createNpmPackageUrl("@dpf/db", "0.1.0")).toBe("pkg:npm/%40dpf/db@0.1.0");
  });

  it("encodes unscoped npm package names", () => {
    expect(createNpmPackageUrl("next", "16.2.6")).toBe("pkg:npm/next@16.2.6");
  });
});
