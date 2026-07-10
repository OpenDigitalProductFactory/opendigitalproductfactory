import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PlatformHealthIndicator", () => {
  it("renders the dropdown above the coworker panel and shell notice layers", () => {
    const source = readFileSync(new URL("./PlatformHealthIndicator.tsx", import.meta.url), "utf8");

    expect(source).toContain("z-[90]");
    expect(source).not.toContain("mt-1 z-50 w-72");
  });

  it("speaks plain language and offers the coworker handoff, not just raw alert names (BI-2F778C13)", () => {
    const source = readFileSync(new URL("./PlatformHealthIndicator.tsx", import.meta.url), "utf8");

    // Humanized title/explanation render instead of the bare alertname…
    expect(source).toContain("humanizeHealthAlert");
    expect(source).toContain("humanized.title");
    expect(source).toContain("humanized.explanation");
    // …and every alert list ends in an actionable coworker handoff.
    expect(source).toContain("open-agent-panel");
    expect(source).toContain("buildHealthAlertCoworkerPrompt");
    expect(source).toContain("Ask coworker for help");
  });
});
