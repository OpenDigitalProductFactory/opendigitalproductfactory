import { describe, expect, it } from "vitest";

import { slugify } from "./slugify";

describe("slugify", () => {
  it("lowercases and replaces spaces with dashes", () => {
    expect(slugify("Hello World")).toBe("hello-world");
    expect(slugify("MiXeD CaSe 123")).toBe("mixed-case-123");
  });

  it("collapses punctuation runs to a single dash", () => {
    expect(slugify("Punctuation!!! Here, There.")).toBe("punctuation-here-there");
    expect(slugify("a.b.c")).toBe("a-b-c");
    expect(slugify("foo/bar\\baz")).toBe("foo-bar-baz");
  });

  it("collapses multiple separators to one dash", () => {
    expect(slugify("multiple   spaces")).toBe("multiple-spaces");
    expect(slugify("a--b")).toBe("a-b");
    expect(slugify("  --weird-- mix __of__ stuff!! ")).toBe("weird-mix-of-stuff");
  });

  it("strips leading and trailing separators", () => {
    expect(slugify("-leading")).toBe("leading");
    expect(slugify("trailing-")).toBe("trailing");
    expect(slugify("---dashes---")).toBe("dashes");
    expect(slugify("end with !!!")).toBe("end-with");
  });

  it("trims surrounding whitespace", () => {
    expect(slugify("  leading and trailing  ")).toBe("leading-and-trailing");
  });

  it("leaves an already-clean slug unchanged", () => {
    expect(slugify("already-clean-slug")).toBe("already-clean-slug");
    expect(slugify("123-456")).toBe("123-456");
  });

  it("returns an empty string when there is nothing alphanumeric", () => {
    expect(slugify("")).toBe("");
    expect(slugify("   ")).toBe("");
    expect(slugify("@@@")).toBe("");
    expect(slugify("---")).toBe("");
  });
});
