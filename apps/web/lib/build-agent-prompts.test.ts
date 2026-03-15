import { describe, expect, it } from "vitest";
import { bumpVersion } from "./feature-build-types";

describe("bumpVersion", () => {
  it("bumps patch version", () => {
    expect(bumpVersion("1.0.0", "patch")).toBe("1.0.1");
  });
  it("bumps minor version and resets patch", () => {
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
  });
  it("bumps major version and resets minor and patch", () => {
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });
  it("handles single-digit versions", () => {
    expect(bumpVersion("0.0.1", "patch")).toBe("0.0.2");
  });
  it("defaults to minor for invalid bump type", () => {
    expect(bumpVersion("1.0.0", "unknown" as "patch")).toBe("1.1.0");
  });
  it("handles malformed version by returning 1.0.0", () => {
    expect(bumpVersion("not-a-version", "patch")).toBe("1.0.0");
  });
});
