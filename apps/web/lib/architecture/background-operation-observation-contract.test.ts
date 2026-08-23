import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = join(__dirname, "..", "..");
const CONTRACT_EXCEPTION = "background-observation-contract-exception BI-B8F44BF7";
const RATCHETED_BASELINE = ["components/ops/PromotionsClient.tsx"];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === ".next") return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) return [];
    return [path];
  });
}

describe("Background Operation Observation Contract", () => {
  it("rejects interval-driven full-route refresh outside the ratcheted legacy baseline", () => {
    const violations = sourceFiles(SOURCE_ROOT)
      .filter((path) => /setInterval[\s\S]{0,240}?router\.refresh\s*\(/.test(readFileSync(path, "utf8")))
      .map((path) => relative(SOURCE_ROOT, path).replaceAll("\\", "/"));

    expect(violations).toEqual(RATCHETED_BASELINE);
    for (const path of violations) {
      expect(readFileSync(join(SOURCE_ROOT, path), "utf8")).toContain(CONTRACT_EXCEPTION);
    }
  });
});
