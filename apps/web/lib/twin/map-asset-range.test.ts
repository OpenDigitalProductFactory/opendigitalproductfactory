import { describe, expect, it } from "vitest";

import { resolveMapAssetRange } from "./map-asset-range";

describe("map asset byte ranges", () => {
  it("returns the whole asset when Range is absent", () => {
    expect(resolveMapAssetRange(null, 100)).toEqual({
      status: "full",
      start: 0,
      end: 99,
      length: 100,
    });
  });

  it.each([
    ["bytes=10-19", { status: "partial", start: 10, end: 19, length: 10 }],
    ["bytes=90-", { status: "partial", start: 90, end: 99, length: 10 }],
    ["bytes=-10", { status: "partial", start: 90, end: 99, length: 10 }],
    ["bytes=90-200", { status: "partial", start: 90, end: 99, length: 10 }],
    ["bytes=-200", { status: "partial", start: 0, end: 99, length: 100 }],
  ])("resolves %s", (header, expected) => {
    expect(resolveMapAssetRange(header, 100)).toEqual(expected);
  });

  it.each(["bytes=100-101", "bytes=20-10", "bytes=-0", "bytes=", "items=0-1", "bytes=0-1,4-5"])(
    "rejects unsupported or unsatisfiable range %s",
    (header) => {
      expect(resolveMapAssetRange(header, 100)).toMatchObject({ status: "unsatisfiable" });
    },
  );

  it("rejects invalid asset lengths before arithmetic", () => {
    expect(() => resolveMapAssetRange(null, 0)).toThrow("Map asset length must be a positive safe integer.");
  });
});
