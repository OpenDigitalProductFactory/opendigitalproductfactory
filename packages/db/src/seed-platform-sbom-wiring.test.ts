import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("platform SBOM seed wiring", () => {
  it("persists the generated platform composition immediately after DPF self-registration", () => {
    const source = readFileSync(join(__dirname, "seed.ts"), "utf8");
    expect(source).toMatch(
      /await step\("dpfSelfRegistration"[^\n]+\n\s*await step\("platformSbom", \(\) => seedPlatformSbom\(\)\);/,
    );
  });
});
