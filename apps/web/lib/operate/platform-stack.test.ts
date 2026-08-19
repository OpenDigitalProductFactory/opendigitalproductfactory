import { describe, expect, it } from "vitest";
import {
  assessPlatformStack,
  PLATFORM_STACK,
  stackCurrencySummary,
  type PlatformStackComponent,
} from "./platform-stack";

const now = new Date("2026-08-15T00:00:00.000Z");

function component(overrides: Partial<PlatformStackComponent>): PlatformStackComponent {
  return {
    key: "x",
    name: "X",
    category: "tooling",
    currentVersion: "1.0",
    supportEndsAt: null,
    referenceUrl: "https://example.com",
    ...overrides,
  };
}

describe("assessPlatformStack", () => {
  it("marks a component with no recorded EOL date as unsourced (no fabricated status)", () => {
    const [row] = assessPlatformStack(now, [component({})]);
    expect(row.currency).toBe("unsourced");
    expect(row.daysUntilEol).toBeNull();
  });

  it("maps a recorded EOL date onto the canonical currency axis", () => {
    const [current] = assessPlatformStack(now, [component({ supportEndsAt: "2030-01-01" })]);
    expect(current.currency).toBe("current");

    const [approaching] = assessPlatformStack(now, [component({ supportEndsAt: "2026-10-01" })]);
    expect(approaching.currency).toBe("approaching-eol"); // within default 180-day window

    const [eol] = assessPlatformStack(now, [component({ supportEndsAt: "2026-01-01" })]);
    expect(eol.currency).toBe("end-of-life");
    expect(eol.daysUntilEol).toBeLessThan(0);
  });

  it("assesses the real curated stack without throwing", () => {
    const assessed = assessPlatformStack(now);
    expect(assessed).toHaveLength(PLATFORM_STACK.length);
    // Every component resolves to a known state.
    for (const row of assessed) {
      expect(["current", "approaching-eol", "unsupported", "end-of-life", "unsourced"]).toContain(row.currency);
    }
  });
});

describe("stackCurrencySummary", () => {
  it("tallies by currency", () => {
    const assessed = assessPlatformStack(now, [
      component({ supportEndsAt: "2030-01-01" }),
      component({ supportEndsAt: "2026-01-01" }),
      component({}),
    ]);
    const summary = stackCurrencySummary(assessed);
    expect(summary.current).toBe(1);
    expect(summary["end-of-life"]).toBe(1);
    expect(summary.unsourced).toBe(1);
  });
});
