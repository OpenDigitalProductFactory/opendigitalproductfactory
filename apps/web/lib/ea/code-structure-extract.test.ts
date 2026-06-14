import { describe, expect, it } from "vitest";
import { buildCodeStructureModel, subsystemFor, CODE_STRUCTURE_PACKAGE_KEY, type CodeImportEdge } from "./code-structure-extract";

describe("subsystemFor", () => {
  it("maps lib areas and packages to subsystems, excludes everything else", () => {
    expect(subsystemFor("apps/web/lib/routing/pipeline-v2.ts")).toBe("apps/web/lib/routing");
    expect(subsystemFor("apps/web/lib/ea/sysml-model-seed.ts")).toBe("apps/web/lib/ea");
    expect(subsystemFor("packages/db/src/seed.ts")).toBe("packages/db");
    expect(subsystemFor("apps/web/app/build/page.tsx")).toBeNull(); // routes = separate domain
    expect(subsystemFor("apps/web/components/Foo.tsx")).toBeNull();
    expect(subsystemFor("scripts/foo.ts")).toBeNull();
  });
});

const EDGES: CodeImportEdge[] = [
  { fromPath: "apps/web/lib/routing/p.ts", toPath: "apps/web/lib/ea/q.ts" }, // routing → ea
  { fromPath: "apps/web/lib/routing/r.ts", toPath: "apps/web/lib/ea/s.ts" }, // routing → ea (dup subsystem dep)
  { fromPath: "apps/web/lib/ea/q.ts", toPath: null }, // ea, no imports
  { fromPath: "apps/web/lib/ea/q.ts", toPath: "apps/web/lib/ea/x.ts" }, // self-subsystem (dropped)
  { fromPath: "apps/web/app/page.tsx", toPath: "apps/web/lib/routing/p.ts" }, // app FROM out of scope (dropped)
  { fromPath: "packages/db/src/a.ts", toPath: "apps/web/lib/routing/p.ts" }, // packages/db → routing
];

describe("buildCodeStructureModel", () => {
  const model = buildCodeStructureModel(EDGES);
  const byKey = new Map(model.elements.map((e) => [e.sysmlKey, e]));

  it("projects subsystems to part_definitions under a package, app/ excluded", () => {
    expect(byKey.get(CODE_STRUCTURE_PACKAGE_KEY)?.typeSlug).toBe("package");
    expect(byKey.get("codestruct:sub:apps/web/lib/routing")?.typeSlug).toBe("part_definition");
    expect(byKey.get("codestruct:sub:apps/web/lib/ea")?.typeSlug).toBe("part_definition");
    expect(byKey.get("codestruct:sub:packages/db")?.typeSlug).toBe("part_definition");
    // pkg + 3 subsystems (app/* never becomes a subsystem)
    expect(model.elements).toHaveLength(4);
  });

  it("emits deduped, self-free subsystem dependencies as connects", () => {
    const connects = model.relationships.filter((r) => r.relSlug === "connects");
    expect(connects).toContainEqual({ fromKey: "codestruct:sub:apps/web/lib/routing", toKey: "codestruct:sub:apps/web/lib/ea", relSlug: "connects" });
    expect(connects).toContainEqual({ fromKey: "codestruct:sub:packages/db", toKey: "codestruct:sub:apps/web/lib/routing", relSlug: "connects" });
    // routing→ea deduped to one; ea→ea self-edge dropped; app→routing dropped (app out of scope)
    expect(connects).toHaveLength(2);
  });

  it("contains every subsystem under the package", () => {
    const contains = model.relationships.filter((r) => r.relSlug === "contains");
    expect(contains).toHaveLength(3);
    expect(contains.every((r) => r.fromKey === CODE_STRUCTURE_PACKAGE_KEY)).toBe(true);
  });

  it("declares its types and re-derives cleanly via soft-remove", () => {
    expect(model.elementTypeSlugs).toEqual(["package", "part_definition"]);
    expect(model.relTypeSlugs).toEqual(["contains", "connects"]);
    expect(model.softRemovePrefix).toBe("codestruct:");
  });
});
