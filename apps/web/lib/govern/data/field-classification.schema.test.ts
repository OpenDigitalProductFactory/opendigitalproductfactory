import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  FIELD_DATA_CLASSIFICATION,
  parseFieldKey,
} from "./field-classification";
import { ALL_DATA_CATEGORIES } from "./taxonomy";
import { readCanonicalPrismaSchema } from "@dpf/db/schema-source";

// Drift guard: every "Model.field" key must name a real column in schema.prisma,
// and every category used must be a real DataCategory. If a classified column is
// renamed or removed, or a bad category slug is used, this fails — so the
// registry can never silently drift from the schema it classifies. Same
// discipline as the stewardship-scope (BI-C34E09B0) and legal-hold (BI-90A8D153)
// guards.


/** model name -> Set of scalar field names, parsed from schema.prisma. */
function schemaModelFields(): Map<string, Set<string>> {
  const src = readCanonicalPrismaSchema();
  const out = new Map<string, Set<string>>();
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const [, name, body] = m;
    const fields = new Set<string>();
    for (const line of body.split("\n")) {
      const fm = /^\s{2,}(\w+)\s+\S/.exec(line);
      if (fm && !line.trim().startsWith("@@") && !line.trim().startsWith("//")) {
        fields.add(fm[1]);
      }
    }
    out.set(name, fields);
  }
  return out;
}

describe("FIELD_DATA_CLASSIFICATION drift guard", () => {
  const models = schemaModelFields();

  it("parsed the schema (sanity: known models + columns present)", () => {
    expect(models.get("Payment")?.has("stripePaymentId")).toBe(true);
    expect(models.get("PatientProfile")?.has("accessibilityNeeds")).toBe(true);
  });

  it("every classified Model.field names a real column in schema.prisma", () => {
    const bad: string[] = [];
    for (const key of Object.keys(FIELD_DATA_CLASSIFICATION)) {
      const parsed = parseFieldKey(key);
      if (!parsed) { bad.push(`${key} (unparseable)`); continue; }
      const fields = models.get(parsed.model);
      if (!fields) { bad.push(`${key} (no such model)`); continue; }
      if (!fields.has(parsed.field)) bad.push(`${key} (no such column)`);
    }
    expect(bad, `classified fields not found in schema: ${bad.join(", ")}`).toEqual([]);
  });

  it("every category used is a real DataCategory", () => {
    const known = new Set<string>(ALL_DATA_CATEGORIES);
    const bad: string[] = [];
    for (const [key, c] of Object.entries(FIELD_DATA_CLASSIFICATION)) {
      for (const cat of c.categories) if (!known.has(cat)) bad.push(`${key}:${cat}`);
    }
    expect(bad).toEqual([]);
  });
});
