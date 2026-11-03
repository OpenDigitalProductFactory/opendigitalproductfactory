import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const webRoot = fileURLToPath(new URL("../../", import.meta.url));
const sourceEntry = resolve(webRoot, "../../packages/validators/src/index.ts");

describe("legacy validators source entry", () => {
  it("loads through the framework CommonJS TypeScript hook without emitted siblings", () => {
    // The isolated NodeNext consumers compile before loading. The application
    // also has a source-loading path, where a literal .js sibling is absent.
    // Use the framework's pinned loader in a child so its require hooks cannot
    // affect the test runner or hide the failure behind Vitest's resolver.
    const program = `
      import { createRequire } from "node:module";
      const require = createRequire(${JSON.stringify(resolve(webRoot, "package.json"))});
      const hook = require("next/dist/build/next-config-ts/require-hook.js");
      hook.registerHook({
        jsc: { parser: { syntax: "typescript" }, target: "es2022" },
        module: { type: "commonjs" },
      });
      try {
        const api = require(${JSON.stringify(sourceEntry)});
        console.log(JSON.stringify({
          scopes: api.DECISION_SCOPES,
          acceptsScope: api.isDecisionScope("wsid"),
          rejectsScope: !api.isDecisionScope("invented"),
          acceptsJson: api.isBoundedTrustedJson({ value: [1, true] }),
          rejectsHostObject: !api.isBoundedTrustedJson(new Date(0)),
        }));
      } finally {
        hook.deregisterHook();
      }
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", program], {
      cwd: webRoot,
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      scopes: ["wwmd", "wwwd", "wsid"],
      acceptsScope: true,
      rejectsScope: true,
      acceptsJson: true,
      rejectsHostObject: true,
    });
  });
});

const portableEntries = [
  "packages/validators/src/workroom/index.ts",
  "packages/validators/src/gpp/browser.ts",
  "packages/validators/src/gpp/compiler.ts",
  "packages/validators/src/judgment/index.ts",
  "packages/validators/src/workroom-policy/index.ts",
  "packages/validators/src/operating-composition/index.ts",
  "packages/storefront-templates/src/operations/index.ts",
  "packages/validators/src/commons/index.ts",
  "packages/validators/src/commons/node.ts",
];

describe("portable source entries", () => {
  it.each(portableEntries)("loads %s with the framework source loader", (entry) => {
    const program = `
      import { createRequire } from "node:module";
      const require = createRequire(${JSON.stringify(resolve(webRoot, "package.json"))});
      const hook = require("next/dist/build/next-config-ts/require-hook.js");
      hook.registerHook({
        jsc: { parser: { syntax: "typescript" }, target: "es2022" },
        module: { type: "commonjs" },
      });
      try {
        const api = require(${JSON.stringify(resolve(webRoot, "../..", entry))});
        console.log(JSON.stringify(Object.keys(api)));
      } finally {
        hook.deregisterHook();
      }
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", program], {
      cwd: webRoot,
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(JSON.parse(result.stdout.trim()).length).toBeGreaterThan(0);
  });
});
