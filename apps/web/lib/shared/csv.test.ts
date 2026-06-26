import { describe, expect, it } from "vitest";

import { escapeCsvField, toCsv } from "./csv";

describe("escapeCsvField", () => {
  it("leaves a plain field unquoted", () => {
    expect(escapeCsvField("plain")).toBe("plain");
    expect(escapeCsvField("")).toBe("");
  });

  it("quotes fields containing a comma", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
  });

  it("quotes fields containing a newline (LF or CRLF)", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvField("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  it("quotes and doubles interior quotes", () => {
    expect(escapeCsvField('he said "hi"')).toBe('"he said ""hi"""');
  });
});

describe("toCsv", () => {
  it("serializes a simple matrix joined with CRLF", () => {
    expect(toCsv([["a", "b"], ["c", "d"]])).toBe("a,b\r\nc,d");
  });

  it("emits the optional header row first", () => {
    expect(toCsv([["1", "2"]], ["x", "y"])).toBe("x,y\r\n1,2");
  });

  it("escapes fields per RFC-4180", () => {
    expect(toCsv([["c,d", 'e"f']], ["x", "y"])).toBe('x,y\r\n"c,d","e""f"');
  });

  it("quotes a cell containing a newline", () => {
    expect(toCsv([["multi\nline", "ok"]])).toBe('"multi\nline",ok');
  });

  it("returns an empty string for no rows and no header", () => {
    expect(toCsv([])).toBe("");
  });

  it("returns just the header when rows are empty", () => {
    expect(toCsv([], ["only", "header"])).toBe("only,header");
  });
});
