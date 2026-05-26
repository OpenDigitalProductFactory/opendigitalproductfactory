import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PlatformHealthIndicator", () => {
  it("renders the dropdown above the coworker panel and shell notice layers", () => {
    const source = readFileSync(new URL("./PlatformHealthIndicator.tsx", import.meta.url), "utf8");

    expect(source).toContain("z-[90]");
    expect(source).not.toContain("mt-1 z-50 w-72");
  });
});
