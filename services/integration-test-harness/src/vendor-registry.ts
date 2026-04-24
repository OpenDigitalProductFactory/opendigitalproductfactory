import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type {
  HarnessScenarioFixture,
  LoadedVendorDefinition,
  VendorDefinition,
  VendorRouteDefinition,
} from "./types.js";

export async function discoverVendors(rootDir: string): Promise<VendorDefinition[]> {
  const entries = await readdir(rootDir);
  const vendors: VendorDefinition[] = [];

  for (const entry of entries) {
    const vendorDir = join(rootDir, entry);
    const vendorStat = await stat(vendorDir);
    if (!vendorStat.isDirectory()) continue;

    const openapiPath = join(vendorDir, "openapi.yaml");
    const routesPath = await findFirstExistingPath(vendorDir, ["routes.js", "routes.ts"]);

    if (!(await exists(openapiPath)) || routesPath === null) {
      continue;
    }

    vendors.push({
      slug: entry,
      openapiPath,
      routesPath,
    });
  }

  return vendors.sort((left, right) => left.slug.localeCompare(right.slug));
}

export async function loadVendors(rootDir: string): Promise<LoadedVendorDefinition[]> {
  const vendors = await discoverVendors(rootDir);

  return await Promise.all(
    vendors.map(async (vendor) => {
      const routes = await loadRoutes(vendor.routesPath);
      return {
        ...vendor,
        scenariosDir: join(rootDir, vendor.slug, "scenarios"),
        routes,
      };
    }),
  );
}

export async function loadScenarioFixture(
  vendor: LoadedVendorDefinition,
  scenario: string,
): Promise<HarnessScenarioFixture> {
  const scenarioPath = join(vendor.scenariosDir, `${scenario}.json`);
  const rawFixture = await readFile(scenarioPath, "utf8");
  return JSON.parse(rawFixture) as HarnessScenarioFixture;
}

async function loadRoutes(path: string): Promise<VendorRouteDefinition[]> {
  const module = (await import(pathToFileURL(path).href)) as { routes?: unknown };

  if (!Array.isArray(module.routes)) {
    throw new Error(`Vendor routes module ${path} does not export a routes array`);
  }

  return module.routes.map(validateRouteDefinition);
}

function validateRouteDefinition(route: unknown): VendorRouteDefinition {
  if (typeof route !== "object" || route === null) {
    throw new Error("Invalid route definition");
  }

  const candidate = route as Record<string, unknown>;
  if (
    typeof candidate.key !== "string"
    || (candidate.method !== "GET" && candidate.method !== "POST")
    || typeof candidate.path !== "string"
  ) {
    throw new Error("Invalid route definition shape");
  }

  return {
    key: candidate.key,
    method: candidate.method,
    path: candidate.path,
  };
}

async function findFirstExistingPath(dir: string, candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    const path = join(dir, candidate);
    if (await exists(path)) {
      return path;
    }
  }

  return null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
