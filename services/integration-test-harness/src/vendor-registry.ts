import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import type { VendorDefinition } from "./types.js";

export async function discoverVendors(rootDir: string): Promise<VendorDefinition[]> {
  const entries = await readdir(rootDir);
  const vendors: VendorDefinition[] = [];

  for (const entry of entries) {
    const vendorDir = join(rootDir, entry);
    const vendorStat = await stat(vendorDir);
    if (!vendorStat.isDirectory()) continue;

    const openapiPath = join(vendorDir, "openapi.yaml");
    const routesPath = join(vendorDir, "routes.ts");

    if (!(await exists(openapiPath)) || !(await exists(routesPath))) {
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

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
