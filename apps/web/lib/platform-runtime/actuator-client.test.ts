// The portal reaches the private actuator only through actuator-client.ts, so
// the wire contract is typed once (BI-224F56F1 repair round 1).
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const web = join(__dirname, "..", "..");
// A static import, dynamic import() or require() of the module, by any
// relative path or extension form; a file list naming it is not one.
const DIRECT = /(?:\bfrom|\bimport\s*\(|\brequire\s*\()\s*["'`](?:\.{1,2}\/)+(?:[\w.-]+\/)*scripts\/lib\/scope-writer-observation(?:\.mjs|\.d\.mts)?["'`]/;
// Held by the S5 writer (BI-687E7D81) while this repair lands; they move to the
// client in that branch. A new entry here needs the same kind of owner reason.
const PENDING_OWNER: Record<string, string> = {
  "lib/mcp/packs/admin-pack.ts": "BI-687E7D81 holds the edit scope",
  "lib/mcp/packs/sandbox-pack.ts": "BI-687E7D81 holds the edit scope",
};

async function sources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return ["node_modules", "coverage"].includes(entry.name) || entry.name.startsWith(".") ? [] : sources(path);
    return /\.(?:ts|tsx|mts|cts|mjs|cjs|js|jsx)$/.test(entry.name) && !/\.test\.|test-support/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

describe("actuator client", () => {
  it("is the portal's only import of the actuator socket module", async () => {
    const files = await sources(web);
    const direct: string[] = [];
    for (const file of files) {
      const path = relative(web, file);
      if (path === "lib/platform-runtime/actuator-client.ts" || PENDING_OWNER[path]) continue;
      if (DIRECT.test(await readFile(file, "utf8"))) direct.push(path);
    }
    expect(direct).toEqual([]);
  });

  it("recognizes every import form", () => {
    for (const form of ['import x from "../../../../scripts/lib/scope-writer-observation.mjs";',
      'await import("../../scripts/lib/scope-writer-observation.mjs")', "require('../../../scripts/lib/scope-writer-observation.mjs')",
      'export { a } from "./../scripts/lib/scope-writer-observation"']) expect(DIRECT.test(form), form).toBe(true);
    expect(DIRECT.test('"scripts/lib/scope-writer-observation.mjs",')).toBe(false);
  });

  it("names one fail-closed mount rule and re-exports it", async () => {
    const client = await import("./actuator-client");
    expect(typeof client.usesPrivateActuator).toBe("function");
    expect(typeof client.usesPrivateActuatorSync).toBe("function");
    const source = await readFile(join(__dirname, "actuator-client.ts"), "utf8");
    expect(source).toMatch(/Rule: fail closed/);
  });
});
