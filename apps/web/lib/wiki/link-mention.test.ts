import { describe, expect, it } from "vitest";

import { findMention, mentionTerms, prepareLinkMention, wrapFirstMention } from "./link-mention";

describe("mentionTerms", () => {
  it("uses the title and the last slug segment, longest first", () => {
    expect(mentionTerms({ title: "Never Assume", slug: "principles/no-assumptions" })).toEqual([
      "no-assumptions",
      "Never Assume",
    ]);
  });
});

describe("findMention", () => {
  it("matches a whole word, case-insensitively", () => {
    expect(findMention("We rely on the CSDM model.", ["csdm"])).toEqual({ index: 15, text: "CSDM" });
  });

  it("ignores a term inside a longer word", () => {
    expect(findMention("csdmx is not it", ["csdm"])).toBeNull();
  });

  it("ignores mentions inside code and inside existing links", () => {
    const body = "Use `csdm` and [[entities/csdm|CSDM]].\n```\ncsdm\n```";
    expect(findMention(body, ["csdm"])).toBeNull();
  });
});

describe("wrapFirstMention", () => {
  it("wraps only the first plain mention as a labelled link, keeping the author's text", () => {
    const body = "See `CSDM` first. The CSDM model and CSDM again.";
    expect(wrapFirstMention(body, "entities/csdm", ["csdm"])).toBe(
      "See `CSDM` first. The [[entities/csdm|CSDM]] model and CSDM again.",
    );
  });

  it("returns null when there is nothing to wrap", () => {
    expect(wrapFirstMention("Nothing here.", "entities/csdm", ["csdm"])).toBeNull();
  });
});

describe("prepareLinkMention", () => {
  it("wraps the mention and says nothing is saved yet", () => {
    const prepared = prepareLinkMention("Our CSDM model.", { slug: "entities/csdm", title: "CSDM" });
    expect(prepared.body).toBe("Our [[entities/csdm|CSDM]] model.");
    expect(prepared.notice).toContain("Nothing has changed yet");
    expect(prepared.changeSummary).toBe("Link the mention of CSDM");
  });

  it("leaves the body alone when the mention is gone", () => {
    const prepared = prepareLinkMention("Nothing here.", { slug: "entities/csdm", title: "CSDM" });
    expect(prepared.body).toBe("Nothing here.");
    expect(prepared.changeSummary).toBeUndefined();
  });
});
