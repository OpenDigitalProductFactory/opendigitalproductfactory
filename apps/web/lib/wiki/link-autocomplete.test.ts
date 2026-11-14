import { describe, expect, it } from "vitest";

import { LINK_QUERY_MIN_LENGTH, findOpenLinkQuery, insertWikiLink } from "./link-autocomplete";

// BI-2F7BE778 AC-KLE-1: what the author is typing after `[[`, and the link
// Enter writes in its place.

describe("findOpenLinkQuery", () => {
  it("reads the text typed after an open [[ up to the caret", () => {
    const text = "See [[budg";
    expect(findOpenLinkQuery(text, text.length)).toEqual({ start: 4, query: "budg" });
  });

  it("needs two characters before suggestions are asked for", () => {
    expect(LINK_QUERY_MIN_LENGTH).toBe(2);
  });

  it("is null once the link is closed, labelled, or broken by a new line", () => {
    expect(findOpenLinkQuery("[[a]] then", 10)).toBeNull();
    expect(findOpenLinkQuery("[[slug|lab", 10)).toBeNull();
    expect(findOpenLinkQuery("[[slug\nmore", 11)).toBeNull();
    expect(findOpenLinkQuery("no link here", 5)).toBeNull();
  });

  it("uses the nearest [[ before the caret, not one after it", () => {
    const text = "[[one]] and [[tw";
    expect(findOpenLinkQuery(text, text.length)).toEqual({ start: 12, query: "tw" });
    expect(findOpenLinkQuery(text, 3)).toEqual({ start: 0, query: "o" });
  });
});

describe("insertWikiLink", () => {
  it("replaces the open token with [[slug|title]] and puts the caret after it", () => {
    const text = "See [[budg and more";
    const result = insertWikiLink(text, { start: 4, end: 10 }, { slug: "entities/budget", title: "Budget" });
    expect(result.text).toBe("See [[entities/budget|Budget]] and more");
    expect(result.caret).toBe("See [[entities/budget|Budget]]".length);
  });

  it("swallows a closing ]] the author already typed", () => {
    const text = "[[bu]] tail";
    const result = insertWikiLink(text, { start: 0, end: 4 }, { slug: "entities/budget", title: "Budget" });
    expect(result.text).toBe("[[entities/budget|Budget]] tail");
  });

  it("keeps the label from breaking the link syntax", () => {
    const result = insertWikiLink("[[x", { start: 0, end: 3 }, { slug: "a/b", title: "Plan | phase [2]" });
    expect(result.text).toBe("[[a/b|Plan / phase (2)]]");
  });
});
