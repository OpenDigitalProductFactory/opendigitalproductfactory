import { describe, expect, it } from "vitest";

import { parseGhPrListJson } from "./github-inventory";

const VALID_JSON = JSON.stringify([
  {
    number: 1205,
    url: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1205",
    title: "docs: specify contributor change lanes",
    headRefName: "doc/contributor-change-lanes",
    baseRefName: "main",
    isDraft: true,
    state: "OPEN",
    mergeStateStatus: "BLOCKED",
  },
  {
    number: 1206,
    url: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1206",
    title: "feat: route acquisition signals",
    headRefName: "feat/acquisition",
    state: "MERGED",
    isDraft: false,
  },
  {
    number: 999,
    url: "https://example.com/pr/999",
    title: "closed pr",
    headRefName: "feat/closed",
    state: "CLOSED",
  },
]);

describe("parseGhPrListJson", () => {
  it("parses each PR object into a snapshot, preserving the URL, branch, draft, and merge-state", () => {
    const result = parseGhPrListJson(VALID_JSON);
    expect(result.errors).toEqual([]);
    expect(result.pullRequests).toHaveLength(3);

    const ccl = result.pullRequests.find((p) => p.number === 1205);
    expect(ccl).toBeDefined();
    expect(ccl!.headBranch).toBe("doc/contributor-change-lanes");
    expect(ccl!.state).toBe("open");
    expect(ccl!.isDraft).toBe(true);
    expect(ccl!.mergeStateStatus).toBe("BLOCKED");

    expect(result.pullRequests.find((p) => p.number === 1206)!.state).toBe("merged");
    expect(result.pullRequests.find((p) => p.number === 999)!.state).toBe("closed");
  });

  it("returns an error and empty list for malformed JSON", () => {
    const result = parseGhPrListJson("not json");
    expect(result.pullRequests).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.source).toBe("pr-list");
  });

  it("returns an error when gh output is not a JSON array", () => {
    const result = parseGhPrListJson('{"foo": "bar"}');
    expect(result.pullRequests).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it("skips entries missing required fields rather than throwing", () => {
    const json = JSON.stringify([
      { number: "not-a-number", url: "x", headRefName: "x" },
      { number: 1, url: 2, headRefName: "x" },
      { number: 5, url: "ok", headRefName: "feat/x", state: "OPEN" },
    ]);
    const result = parseGhPrListJson(json);
    expect(result.pullRequests).toHaveLength(1);
    expect(result.pullRequests[0]!.number).toBe(5);
  });

  it("handles empty input as no errors and no PRs", () => {
    const result = parseGhPrListJson("");
    expect(result.pullRequests).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});
