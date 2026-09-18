import { describe, expect, it } from "vitest";
import { canonicalWorkCaseHref } from "./canonical-case-key";

describe("canonical Workroom navigation", () => {
  it("preserves operation, selected step and repeated filters across alias resolution", () => {
    const href = canonicalWorkCaseHref("backlog-item%3ABI-06AE6833", {
      operation: "reviewer recovery & release", processStep: "deploy",
      processLayout: "list", filter: ["waiting", "unknown"], absent: undefined,
    });
    const url = new URL(href, "https://portal.example");
    expect(url.pathname).toBe("/workspace/cases/backlog-item%3ABI-06AE6833");
    expect(url.searchParams.get("operation")).toBe("reviewer recovery & release");
    expect(url.searchParams.get("processStep")).toBe("deploy");
    expect(url.searchParams.get("processLayout")).toBe("list");
    expect(url.searchParams.getAll("filter")).toEqual(["waiting", "unknown"]);
    expect(url.searchParams.has("absent")).toBe(false);
  });

  it("keeps a case without query context free of an empty query suffix", () => {
    expect(canonicalWorkCaseHref("backlog-item%3ABI-06AE6833", {}))
      .toBe("/workspace/cases/backlog-item%3ABI-06AE6833");
  });
});
