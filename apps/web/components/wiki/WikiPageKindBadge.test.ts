import { describe, expect, it } from "vitest";
import {
  WIKI_PAGE_KIND_LABELS,
  getWikiPageKindLabel,
} from "./WikiPageKindBadge";

describe("WIKI_PAGE_KIND_LABELS", () => {
  it("includes a label for every documented wiki page kind", () => {
    expect(WIKI_PAGE_KIND_LABELS).toEqual({
      entity: "Entity",
      summary: "Summary",
      decision: "Decision",
      runbook: "Runbook",
      index: "Index",
      stance: "Stance",
      heuristic: "Heuristic",
      principle: "Principle",
    });
  });

  it("adds a Principle label as the 8th kind", () => {
    expect(WIKI_PAGE_KIND_LABELS.principle).toBe("Principle");
    expect(Object.keys(WIKI_PAGE_KIND_LABELS)).toHaveLength(8);
  });
});

describe("getWikiPageKindLabel", () => {
  it("resolves the documented label for known kinds", () => {
    expect(getWikiPageKindLabel("principle")).toBe("Principle");
    expect(getWikiPageKindLabel("entity")).toBe("Entity");
    expect(getWikiPageKindLabel("stance")).toBe("Stance");
  });

  it("falls back to the raw kind string for unknown values so badges still render legibly", () => {
    expect(getWikiPageKindLabel("unknown_kind")).toBe("unknown_kind");
    expect(getWikiPageKindLabel("")).toBe("");
  });
});
