import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("PlatformDevConfig invariants", () => {
  it("contributionModel has no default in schema — fresh rows must be null", () => {
    const schema = readFileSync(resolve(__dirname, "../prisma/schema.prisma"), "utf8");
    const block = schema.match(/model PlatformDevConfig \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(block, "PlatformDevConfig model block not found").not.toBe("");
    const line = block.split("\n").find((l) => l.trim().startsWith("contributionModel"));
    expect(line, "contributionModel field must exist on PlatformDevConfig").toBeDefined();
    expect(line, "contributionModel must NOT have @default(...)").not.toMatch(/@default/);
    expect(line, "contributionModel must be optional (String?)").toMatch(/String\?/);
  });

  it("fork fields are nullable with no defaults", () => {
    const schema = readFileSync(resolve(__dirname, "../prisma/schema.prisma"), "utf8");
    const block = schema.match(/model PlatformDevConfig \{[\s\S]*?\n\}/)?.[0] ?? "";
    for (const field of ["contributorForkOwner", "contributorForkRepo", "forkVerifiedAt"]) {
      const line = block.split("\n").find((l) => l.trim().startsWith(field));
      expect(line, `${field} must exist`).toBeDefined();
      expect(line, `${field} must NOT have @default(...)`).not.toMatch(/@default/);
      expect(line, `${field} must be optional`).toMatch(/\?/);
    }
  });

  it("seed.ts does not write contributionModel — first-time setup must go through admin UI", () => {
    const seed = readFileSync(resolve(__dirname, "./seed.ts"), "utf8");
    expect(
      seed,
      "seed must not write contributionModel; default value stays null until admin configures the contribution flow",
    ).not.toMatch(/contributionModel/);
  });
});
