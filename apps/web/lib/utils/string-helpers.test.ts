import { describe, expect, it } from "vitest";
import { truncateMiddle } from "./string-helpers";

describe("truncateMiddle", () => {
  it("elides the middle to fit maxLength and keeps the ellipsis (AC1)", () => {
    const out = truncateMiddle("abcdefghij", 7);
    expect(out).toHaveLength(7);
    expect(out).toContain("…");
    expect(out).toBe("abc…hij");
  });

  it("returns the original string unchanged when it already fits (AC2)", () => {
    expect(truncateMiddle("abc", 10)).toBe("abc");
  });

  it("truncates an odd maxLength and keeps the ellipsis (AC3)", () => {
    const out = truncateMiddle("verylongstring", 5);
    expect(out).toHaveLength(5);
    expect(out).toContain("…");
  });

  it("elides the middle of a realistic file path (AC4)", () => {
    const out = truncateMiddle("file/path/to/some/very/long/filename.txt", 20);
    expect(out).toHaveLength(20);
    expect(out).toContain("…");
    expect(out.startsWith("file/path")).toBe(true);
    expect(out.endsWith(".txt")).toBe(true);
  });

  it("returns just the ellipsis when maxLength is 1 (AC5)", () => {
    expect(truncateMiddle("abc", 1)).toBe("…");
  });

  it("returns the input unchanged when its length equals maxLength", () => {
    expect(truncateMiddle("abcde", 5)).toBe("abcde");
  });

  it("throws when maxLength is below 1", () => {
    expect(() => truncateMiddle("abc", 0)).toThrow();
    expect(() => truncateMiddle("abc", -3)).toThrow();
  });
});
