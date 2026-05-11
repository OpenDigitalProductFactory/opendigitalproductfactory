import { describe, expect, it } from "vitest";
import { splitWikilinks } from "./WikiBodyRenderer";

describe("splitWikilinks", () => {
  it("returns the whole string when no wikilinks are present", () => {
    expect(splitWikilinks("plain text without brackets")).toEqual([
      { kind: "text", value: "plain text without brackets" },
    ]);
  });

  it("recognises a bare [[slug]]", () => {
    expect(splitWikilinks("see [[entities/digital-product]] now")).toEqual([
      { kind: "text", value: "see " },
      { kind: "wikilink", slug: "entities/digital-product", label: "entities/digital-product" },
      { kind: "text", value: " now" },
    ]);
  });

  it("recognises [[slug|label]]", () => {
    expect(splitWikilinks("see [[entities/digital-product|the DP page]]")).toEqual([
      { kind: "text", value: "see " },
      { kind: "wikilink", slug: "entities/digital-product", label: "the DP page" },
    ]);
  });

  it("handles multiple wikilinks in one string", () => {
    expect(splitWikilinks("[[a]] then [[b|Label B]] and [[c]]")).toEqual([
      { kind: "wikilink", slug: "a", label: "a" },
      { kind: "text", value: " then " },
      { kind: "wikilink", slug: "b", label: "Label B" },
      { kind: "text", value: " and " },
      { kind: "wikilink", slug: "c", label: "c" },
    ]);
  });

  it("leaves malformed brackets as plain text", () => {
    expect(splitWikilinks("not a [[ link with spaces ]] here")).toEqual([
      { kind: "text", value: "not a [[ link with spaces ]] here" },
    ]);
  });

  it("does not match a single-bracket [link]", () => {
    expect(splitWikilinks("a [link] only")).toEqual([
      { kind: "text", value: "a [link] only" },
    ]);
  });

  it("returns an empty array for an empty string", () => {
    expect(splitWikilinks("")).toEqual([]);
  });
});
