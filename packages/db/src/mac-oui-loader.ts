// mac-oui-loader.ts
//
// Seeds the IEEE OUI registry into `MacVendorOui`.
//
// Mirrors `discovery-fingerprint-catalog-loader.ts`: shipped reference data read
// from disk in Node context at seed time, not at request time. The registry is
// ~39k rows and changes only when IEEE publishes, so it is loaded in bulk and
// refreshed idempotently rather than upserted row-by-row on every sweep.

import { readFile } from "node:fs/promises";
import * as path from "node:path";

import { parseOuiRegistry } from "./mac-oui";

/** Where the shipped registry lives, relative to this module's directory. */
export function defaultOuiRegistryPath(baseDir: string): string {
  return path.join(baseDir, "..", "data", "oui.tsv");
}

export type OuiSeedClient = {
  macVendorOui: {
    createMany(args: {
      data: Array<{ oui: string; vendor: string }>;
      skipDuplicates?: boolean;
    }): Promise<{ count: number }>;
    count(): Promise<number>;
    deleteMany(args?: Record<string, never>): Promise<{ count: number }>;
  };
};

export type OuiSeedResult = {
  parsed: number;
  loaded: number;
  skippedMalformed: number;
};

/**
 * Load the registry into the table, replacing whatever was there.
 *
 * Replace-then-insert rather than per-row upsert: this is a published dataset with
 * no local edits to preserve, 39k round-trips would dominate seed time, and a
 * vendor that IEEE reassigns should not linger as a stale row.
 */
export async function loadOuiRegistryIntoDb(
  db: OuiSeedClient,
  registryPath: string,
): Promise<OuiSeedResult> {
  const raw = await readFile(registryPath, "utf8");
  const rows = parseOuiRegistry(raw);
  const totalLines = raw.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#")).length;

  await db.macVendorOui.deleteMany();

  // Chunked: a single 39k-row createMany exceeds the driver's parameter budget.
  const CHUNK = 5_000;
  let loaded = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const result = await db.macVendorOui.createMany({
      data: rows.slice(i, i + CHUNK),
      skipDuplicates: true,
    });
    loaded += result.count;
  }

  return { parsed: rows.length, loaded, skippedMalformed: totalLines - rows.length };
}
