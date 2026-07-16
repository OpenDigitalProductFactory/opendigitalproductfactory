import { describe, expect, it } from "vitest";
import { formatUpgradeScope } from "./format-upgrade-scope";

describe("formatUpgradeScope (BI-57E57347)", () => {
  it("renders a short human-readable upgrade span", () => {
    expect(
      formatUpgradeScope(
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ),
    ).toBe("Upgrade scope: aaaaaaaaaaaa… → bbbbbbbbbbbb…");
  });

  it("returns null when either side is missing", () => {
    expect(formatUpgradeScope(null, "abc")).toBeNull();
    expect(formatUpgradeScope("abc", null)).toBeNull();
  });
});
