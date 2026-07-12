import { describe, expect, it } from "vitest";

import { parseMentions, resolveMentions } from "./mentions";

describe("parseMentions (BI-B416B12A)", () => {
  it("extracts unique handles in first-seen order, lowercased", () => {
    expect(parseMentions("hey @Mark and @ops-coworker, ping @mark again")).toEqual([
      "mark",
      "ops-coworker",
    ]);
  });

  it("returns nothing for an empty body or no mentions", () => {
    expect(parseMentions("")).toEqual([]);
    expect(parseMentions("no mentions here")).toEqual([]);
  });

  it("does not treat email addresses or @@ as mentions", () => {
    expect(parseMentions("email me at me@example.com")).toEqual([]);
    expect(parseMentions("literal @@ token")).toEqual([]);
  });

  it("matches a mention at the very start of the body", () => {
    expect(parseMentions("@founder please review")).toEqual(["founder"]);
  });
});

describe("resolveMentions (BI-B416B12A)", () => {
  const roster = {
    mark: { type: "user" as const, id: "user-1" },
    "ops-coworker": { type: "agent" as const, id: "agent-9" },
  };

  it("resolves known handles to typed notification targets and drops unknown ones", () => {
    const targets = resolveMentions("@mark and @nobody, cc @ops-coworker", roster);
    expect(targets).toEqual([
      { handle: "mark", type: "user", id: "user-1" },
      { handle: "ops-coworker", type: "agent", id: "agent-9" },
    ]);
  });

  it("matches roster entries case-insensitively", () => {
    const targets = resolveMentions("hi @MARK", roster);
    expect(targets).toEqual([{ handle: "mark", type: "user", id: "user-1" }]);
  });

  it("returns no targets when nobody is mentioned", () => {
    expect(resolveMentions("just a comment", roster)).toEqual([]);
  });
});
