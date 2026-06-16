// Merge a GitHub Traffic API snapshot into append-only daily CSVs.
//
// GitHub keeps clone/view traffic for only a rolling 14-day window, so each
// API response overlaps the previous one. We therefore UPSERT by date (the
// latest snapshot wins for any given day) rather than blindly appending, then
// write the full series back sorted by date. Run by the snapshot-traffic
// workflow; not intended for manual edits.
//
// Usage: node merge-traffic.mjs <dataDir> <clonesJson> <viewsJson>

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Upsert the daily rows from a Traffic API payload into a CSV.
 * @param {string} csvPath   destination CSV (date,count,uniques)
 * @param {string} jsonPath  Traffic API response file
 * @param {string} key       "clones" or "views" - the array field in the payload
 * @returns {number} total number of distinct days now in the series
 */
function mergeSeries(csvPath, jsonPath, key) {
  const payload = JSON.parse(readFileSync(jsonPath, "utf8"));
  const incoming = Array.isArray(payload[key]) ? payload[key] : [];

  /** @type {Map<string, {count: number, uniques: number}>} */
  const byDate = new Map();

  // Seed with whatever history already exists on the data branch. Read
  // directly and treat a missing file as empty history - avoids the
  // exists()-then-read() time-of-check/time-of-use race (CodeQL js/file-system-race).
  let existing = "";
  try {
    existing = readFileSync(csvPath, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  for (const line of existing.trim().split("\n").slice(1)) {
    if (!line.trim()) continue;
    const [date, count, uniques] = line.split(",");
    byDate.set(date, { count: Number(count), uniques: Number(uniques) });
  }

  // Overlay the fresh 14-day window; same-date rows are replaced.
  for (const row of incoming) {
    const date = String(row.timestamp).slice(0, 10);
    byDate.set(date, { count: Number(row.count), uniques: Number(row.uniques) });
  }

  const sorted = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  const out = ["date,count,uniques", ...sorted.map(([d, v]) => `${d},${v.count},${v.uniques}`)];
  writeFileSync(csvPath, out.join("\n") + "\n");
  return sorted.length;
}

const [, , dataDir, clonesJson, viewsJson] = process.argv;
if (!dataDir || !clonesJson || !viewsJson) {
  console.error("Usage: node merge-traffic.mjs <dataDir> <clonesJson> <viewsJson>");
  process.exit(2);
}

const clones = mergeSeries(join(dataDir, "clones.csv"), clonesJson, "clones");
const views = mergeSeries(join(dataDir, "views.csv"), viewsJson, "views");
console.log(`clones.csv: ${clones} day(s); views.csv: ${views} day(s).`);
