import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { discoverVendors, loadScenarioFixture, loadVendors } from "./vendor-registry.js";

describe("vendor-registry", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // ignore cleanup issues in test
      }
    }
  });

  it("discovers only vendor directories with an openapi file and routes module", async () => {
    const root = mkdtempSync(join(tmpdir(), "dpf-harness-vendors-"));
    roots.push(root);

    const adpDir = join(root, "adp");
    mkdirSync(adpDir, { recursive: true });
    writeFileSync(join(adpDir, "openapi.yaml"), "openapi: 3.0.0\ninfo:\n  title: ADP\n  version: 1.0.0\n");
    writeFileSync(join(adpDir, "routes.ts"), "export const routes = [];\n");

    const brokenDir = join(root, "broken");
    mkdirSync(brokenDir, { recursive: true });
    writeFileSync(join(brokenDir, "openapi.yaml"), "openapi: 3.0.0\n");

    const vendors = await discoverVendors(root);

    expect(vendors).toEqual([
      {
        slug: "adp",
        openapiPath: join(adpDir, "openapi.yaml"),
        routesPath: join(adpDir, "routes.ts"),
      },
    ]);
  });

  it("loads route modules and scenario fixtures from discovered vendors", async () => {
    const root = mkdtempSync(join(tmpdir(), "dpf-harness-vendors-"));
    roots.push(root);

    const adpDir = join(root, "adp");
    mkdirSync(join(adpDir, "scenarios"), { recursive: true });
    writeFileSync(join(adpDir, "openapi.yaml"), "openapi: 3.0.0\ninfo:\n  title: ADP\n  version: 1.0.0\n");
    writeFileSync(
      join(adpDir, "routes.js"),
      "export const routes = [{ key: 'workers', method: 'GET', path: '/hr/v2/workers' }];\n",
    );
    writeFileSync(
      join(adpDir, "scenarios", "happy-path.json"),
      JSON.stringify({
        workers: {
          status: 200,
          headers: { "content-type": "application/json" },
          body: { workers: [] },
        },
      }),
    );

    const vendors = await loadVendors(root);
    const fixture = await loadScenarioFixture(vendors[0]!, "happy-path");

    expect(vendors).toEqual([
      {
        slug: "adp",
        openapiPath: join(adpDir, "openapi.yaml"),
        routesPath: join(adpDir, "routes.js"),
        scenariosDir: join(adpDir, "scenarios"),
        routes: [{ key: "workers", method: "GET", path: "/hr/v2/workers" }],
      },
    ]);
    expect(fixture.workers?.status).toBe(200);
  });
});
