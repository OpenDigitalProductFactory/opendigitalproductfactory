import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BI-PIR-53d2c42d — the standalone server must always ship prom-client.
 *
 * lib/operate/metrics.ts loads prom-client through a guarded `require` so that
 * scripts run from /app/apps/web-src (where prom-client is not installed)
 * degrade to no-op metrics instead of crashing. The flip side: if Next's
 * tracing ever stopped seeing that require, the production server would also
 * degrade — silently — and /api/metrics would go empty. next.config.mjs pins
 * prom-client and its runtime dependency closure into outputFileTracingIncludes
 * so that cannot happen. This test keeps that pin present, pointing at real
 * packages, and complete as prom-client's dependencies change.
 */

const APP_DIR = path.resolve(__dirname, "../..");
const ROOT_MODULES = path.resolve(APP_DIR, "../../node_modules");

/** Installed dir of a package in either pnpm layout (hoisted, or app-local symlink). */
function installedDir(name: string): string | null {
  for (const candidate of [path.join(ROOT_MODULES, name), path.join(APP_DIR, "node_modules", name)]) {
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
  }
  return null;
}

function runtimeDependencyClosure(rootName: string): Set<string> {
  const seen = new Set<string>();
  const queue = [rootName];
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const dir = installedDir(name);
    if (!dir) continue;
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    queue.push(...Object.keys(pkg.dependencies ?? {}));
  }
  return seen;
}

describe("next.config prom-client standalone trace pin", () => {
  it("includes the prom-client closure for every route", async () => {
    const mod = await import("../../next.config.mjs");
    const includes = mod.default.outputFileTracingIncludes?.["**/*"] ?? [];
    expect(mod.PROM_CLIENT_TRACE_INCLUDES.length).toBeGreaterThan(0);
    for (const glob of mod.PROM_CLIENT_TRACE_INCLUDES) {
      expect(includes).toContain(glob);
    }
  });

  it("pins every package for both the hoisted and the isolated (Docker) layout", async () => {
    const mod = await import("../../next.config.mjs");
    const includes: string[] = mod.PROM_CLIENT_TRACE_INCLUDES;
    expect(includes).toContain("./node_modules/prom-client/**");
    for (const name of mod.PROM_CLIENT_TRACE_PACKAGES as string[]) {
      expect(includes).toContain(`../../node_modules/${name}/**`);
      expect(includes).toContain(`../../node_modules/.pnpm/${name.replace("/", "+")}@*/node_modules/**`);
    }
  });

  it("names packages that are actually installed", async () => {
    const mod = await import("../../next.config.mjs");
    for (const name of mod.PROM_CLIENT_TRACE_PACKAGES as string[]) {
      const isolated =
        existsSync(path.join(ROOT_MODULES, ".pnpm")) &&
        readdirSync(path.join(ROOT_MODULES, ".pnpm")).some((d) => d.startsWith(`${name.replace("/", "+")}@`));
      expect(installedDir(name) !== null || isolated, name).toBe(true);
    }
  });

  it("covers prom-client's full runtime dependency closure", async () => {
    const mod = await import("../../next.config.mjs");
    const pinned = new Set<string>(mod.PROM_CLIENT_TRACE_PACKAGES);
    const closure = runtimeDependencyClosure("prom-client");
    expect([...closure].filter((name) => !pinned.has(name))).toEqual([]);
  });
});
