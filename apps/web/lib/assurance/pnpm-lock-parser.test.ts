import { describe, expect, it } from "vitest";
import { parseImporterDependencies } from "./pnpm-lock-parser";

const lockText = `
lockfileVersion: '9.0'
importers:
  apps/web:
    dependencies:
      next:
        specifier: ^16.2.6
        version: 16.2.6(react@19.2.6)
      '@dpf/db':
        specifier: workspace:*
        version: link:../../packages/db
    devDependencies:
      vitest:
        specifier: ^4.1.5
        version: 4.1.5
`;

describe("parseImporterDependencies", () => {
  it("extracts production dependencies for a workspace importer", () => {
    expect(parseImporterDependencies(lockText, "apps/web")).toEqual([
      {
        name: "next",
        specifier: "^16.2.6",
        resolvedVersion: "16.2.6",
        dependencyKind: "dependencies",
      },
      {
        name: "@dpf/db",
        specifier: "workspace:*",
        resolvedVersion: "workspace:*",
        dependencyKind: "dependencies",
      },
    ]);
  });
});
