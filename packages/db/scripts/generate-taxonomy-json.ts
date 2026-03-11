// packages/db/scripts/generate-taxonomy-json.ts
// Run once: npx tsx packages/db/scripts/generate-taxonomy-json.ts
// Reads taxonomy_v2.csv from the old project, outputs taxonomy_v2.json for seed.ts

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// Adjust this path to wherever the old project lives
const CSV_PATH = "D:/digital-product-factory/PORTFOLIOS/taxonomy_v2.csv";
const OUT_DIR  = join(__dirname, "..", "data");
const OUT_PATH = join(OUT_DIR, "taxonomy_v2.json");

type TaxonomyRow = {
  portfolio:    string;
  portfolio_id: string;
  level_1:      string;
  level_2:      string;
  level_3:      string;
  definition:   string;
  notes:        string;
};

function parseCSV(content: string): TaxonomyRow[] {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").filter((l) => l.trim().length > 0);
  const rows: TaxonomyRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const fields = splitCSVLine(line);
    rows.push({
      portfolio:    strip(fields[0] ?? ""),
      portfolio_id: strip(fields[1] ?? ""),
      level_1:      strip(fields[2] ?? ""),
      level_2:      strip(fields[3] ?? ""),
      level_3:      strip(fields[4] ?? ""),
      definition:   strip(fields[5] ?? ""),
      notes:        strip(fields[6] ?? ""),
    });
  }
  return rows;
}

/** Splits a CSV line respecting quoted fields containing commas. */
function splitCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function strip(s: string): string {
  return s.trim().replace(/^"|"$/g, "");
}

mkdirSync(OUT_DIR, { recursive: true });
const content = readFileSync(CSV_PATH, "utf-8");
const rows    = parseCSV(content);
writeFileSync(OUT_PATH, JSON.stringify(rows, null, 2), "utf-8");
console.log(`Written ${rows.length} rows to ${OUT_PATH}`);
