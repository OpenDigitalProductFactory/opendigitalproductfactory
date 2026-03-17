import { describe, it, expect } from "vitest";
import { parseDependencies, countPrismaModels, mergeManifest } from "./manifest-generator";

describe("parseDependencies", () => {
  it("extracts dependencies from package.json content", () => {
    const pkg = JSON.stringify({
      dependencies: { next: "16.1.0", react: "^18.3.0" },
      devDependencies: { vitest: "^1.6.0" },
    });
    const deps = parseDependencies(pkg);
    expect(deps).toHaveLength(2); // only dependencies, not devDependencies
    expect(deps[0]).toEqual({ name: "next", version: "16.1.0", license: "unknown", purpose: "" });
  });
  it("returns empty array for invalid JSON", () => {
    expect(parseDependencies("not json")).toEqual([]);
  });
});

describe("countPrismaModels", () => {
  it("counts model declarations in schema", () => {
    const schema = `
model User {
  id String @id
}

model Post {
  id String @id
}

enum Role {
  ADMIN
}
`;
    expect(countPrismaModels(schema)).toBe(2);
  });
});

describe("mergeManifest", () => {
  it("merges base with auto-generated data", () => {
    const base = {
      platform: { name: "Test", techStack: {} },
      modules: [{ id: "m1", path: "src/" }],
      capabilityMap: {},
      boundaries: {},
    };
    const auto = {
      externalDependencies: [{ name: "foo", version: "1.0", license: "MIT", purpose: "" }],
      statistics: { totalFiles: 10, totalLines: 500, moduleCount: 1, externalDependencyCount: 1, dataModelCount: 5 },
    };
    const result = mergeManifest(base, auto);
    expect(result.platform.name).toBe("Test");
    expect(result.externalDependencies).toHaveLength(1);
    expect(result.statistics.totalFiles).toBe(10);
  });
});
