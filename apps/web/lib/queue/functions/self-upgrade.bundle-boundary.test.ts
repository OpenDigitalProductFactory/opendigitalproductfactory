import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(testDir, "self-upgrade.ts");

describe("self-upgrade bundle boundary", () => {
  it("keeps promoter execution out of the statically bundled Inngest graph", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).not.toMatch(
      /import\s+\{[^}]*\b(?:runPromoter|isPromoterAvailable)\b[^}]*\}\s+from\s+["']@\/lib\/self-upgrade\/promoter["']/,
    );
    expect(source).toContain("turbopackIgnore");
  });
});
