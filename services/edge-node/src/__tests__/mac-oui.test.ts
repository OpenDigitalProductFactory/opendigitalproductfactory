import { afterEach, describe, expect, it } from "vitest";
import {
  _resetMacOuiCache,
  lookupOui,
  normalizeMac,
  shortVendor,
  type MacOuiAdapter,
} from "../lib/mac-oui";

afterEach(() => {
  _resetMacOuiCache();
});

const sampleTsv = [
  "FCA183\tAmazon Technologies Inc.",
  "9C8ECD\tReolink Innovation Limited",
  "B827EB\tRaspberry Pi Foundation",
  "F0272D\tApple, Inc.",
  "# blank lines + comments below are tolerated",
  "",
  "GARBAGE_LINE_NO_TAB",
  "TOOSHORT\tShould skip",
].join("\n");

function stubAdapter(tsv: string = sampleTsv): MacOuiAdapter {
  return { readTsv: () => tsv };
}

describe("normalizeMac", () => {
  it.each([
    ["aa:bb:cc:dd:ee:ff", "AABBCCDDEEFF"],
    ["AA-BB-CC-DD-EE-FF", "AABBCCDDEEFF"],
    ["AABB.CCDD.EEFF", "AABBCCDDEEFF"],
    ["AABBCCDDEEFF", "AABBCCDDEEFF"],
    ["aa bb cc dd ee ff", "AABBCCDDEEFF"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeMac(input)).toBe(expected);
  });

  it.each([
    "",
    "not-a-mac",
    "aa:bb:cc:dd:ee",
    "zz:bb:cc:dd:ee:ff",
    "aa:bb:cc:dd:ee:ff:00",
  ])("rejects %s", (input) => {
    expect(normalizeMac(input)).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(normalizeMac(undefined as unknown as string)).toBeNull();
    expect(normalizeMac(null as unknown as string)).toBeNull();
  });
});

describe("lookupOui", () => {
  it("returns vendor for a known OUI in any MAC notation", () => {
    expect(lookupOui("FC:A1:83:11:22:33", stubAdapter())).toEqual({
      oui: "FCA183",
      vendor: "Amazon Technologies Inc.",
    });
    expect(lookupOui("fca183-aabbcc", stubAdapter())).toEqual({
      oui: "FCA183",
      vendor: "Amazon Technologies Inc.",
    });
  });

  it("returns null for an unknown OUI", () => {
    expect(lookupOui("DE:AD:BE:EF:00:00", stubAdapter())).toBeNull();
  });

  it("returns null on an unparseable MAC", () => {
    expect(lookupOui("not-a-mac", stubAdapter())).toBeNull();
  });

  it("returns null when the dataset file is missing (graceful no-op)", () => {
    expect(lookupOui("FC:A1:83:11:22:33", { readTsv: () => "" })).toBeNull();
  });

  it("ignores comments and malformed lines in the TSV", () => {
    expect(lookupOui("9C:8E:CD:00:00:00", stubAdapter())).toEqual({
      oui: "9C8ECD",
      vendor: "Reolink Innovation Limited",
    });
    expect(lookupOui("B8:27:EB:11:22:33", stubAdapter())).toEqual({
      oui: "B827EB",
      vendor: "Raspberry Pi Foundation",
    });
  });

  it("loads the dataset exactly once per adapter (cache stable across calls)", () => {
    let reads = 0;
    const adapter: MacOuiAdapter = {
      readTsv: () => {
        reads += 1;
        return sampleTsv;
      },
    };
    lookupOui("FC:A1:83:11:22:33", adapter);
    lookupOui("9C:8E:CD:00:00:00", adapter);
    lookupOui("F0:27:2D:DE:AD:BE", adapter);
    expect(reads).toBe(1);
  });
});

describe("shortVendor", () => {
  it.each([
    ["Apple, Inc.", "Apple"],
    ["Amazon Technologies Inc.", "Amazon"],
    ["Reolink Innovation Limited", "Reolink"],
    ["TP-LINK TECHNOLOGIES CO.,LTD.", "TP-LINK"],
    ["Cisco Systems, Inc", "Cisco Systems"],
    ["Ubiquiti Inc", "Ubiquiti"],
    ["HUAWEI TECHNOLOGIES CO.,LTD", "HUAWEI"],
  ])("'%s' → '%s'", (input, expected) => {
    expect(shortVendor(input)).toBe(expected);
  });

  it("is a no-op for already-short names", () => {
    expect(shortVendor("Google")).toBe("Google");
  });
});
