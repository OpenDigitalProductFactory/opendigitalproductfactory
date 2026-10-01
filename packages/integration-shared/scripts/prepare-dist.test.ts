// Tests for the image-only dist preparation of @dpf/integration-shared.
// Runs with the package's vitest suite.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { addJsExtensions, prepareDist, rewriteManifest, toDistEntry } from "./prepare-dist.mjs";

describe("prepare-dist", () => {
  test("toDistEntry maps source entries to compiled ones", () => {
    expect(toDistEntry("./src/index.ts")).toBe("./dist/index.js");
    expect(toDistEntry("./src/a/b.ts")).toBe("./dist/a/b.js");
    expect(toDistEntry("./dist/index.js")).toBe("./dist/index.js");
  });

  test("rewriteManifest points main, types and every exports entry at dist/", () => {
    const next = rewriteManifest({
      name: "@dpf/integration-shared",
      main: "./src/index.ts",
      types: "./src/index.ts",
      exports: { ".": "./src/index.ts", "./tier": "./src/mcp-catalog-tier.ts" },
      dependencies: { undici: "^8.10.0" },
    });
    expect(next.main).toBe("./dist/index.js");
    expect(next.types).toBe("./dist/index.d.ts");
    expect(next.exports).toEqual({ ".": "./dist/index.js", "./tier": "./dist/mcp-catalog-tier.js" });
    expect(next.dependencies).toEqual({ undici: "^8.10.0" });
  });

  test("addJsExtensions completes extensionless relative specifiers only", () => {
    const files = new Set(["./redact.js", "./sub/index.js"]);
    const out = addJsExtensions(
      [
        'export * from "./redact";',
        "export { x } from './sub';",
        'import "./redact";',
        'const m = await import("./redact");',
        'export * from "./already.js";',
        'import { fetch } from "undici";',
        'export * from "./missing";',
      ].join("\n"),
      (spec: string) => files.has(spec),
    );
    expect(out).toBe(
      [
        'export * from "./redact.js";',
        "export { x } from './sub/index.js';",
        'import "./redact.js";',
        'const m = await import("./redact.js");',
        'export * from "./already.js";',
        'import { fetch } from "undici";',
        'export * from "./missing";',
      ].join("\n"),
    );
  });

  test("prepareDist makes a package directory loadable by Node", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prepare-dist-"));
    try {
      mkdirSync(join(dir, "dist"));
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "fixture", type: "module", main: "./src/index.ts", exports: { ".": "./src/index.ts" } }),
      );
      writeFileSync(join(dir, "dist", "index.js"), 'export * from "./redact";\n');
      writeFileSync(join(dir, "dist", "redact.js"), "export const redact = () => 'ok';\n");

      expect(prepareDist(dir)).toEqual({ rewritten: 1 });
      expect(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).exports).toEqual({ ".": "./dist/index.js" });
      const mod = await import(join(dir, "dist", "index.js"));
      expect(mod.redact()).toBe("ok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
