import { describe, it, expect } from "vitest";
import { matchPsl001 } from "./audit-prompt-state-leakage";

describe("PSL-001 forbidden phrases", () => {
  it("matches `currently []`", () => {
    const out = matchPsl001("the grants are currently [] (empty)", "x.md");
    expect(out).toHaveLength(1);
    expect(out[0]!.match.toLowerCase()).toContain("currently");
  });

  it("matches `pending follow-on assignment`", () => {
    const out = matchPsl001("pending follow-on assignment per the plan", "x.md");
    expect(out).toHaveLength(1);
  });

  it("matches `once the per-agent grant`", () => {
    const out = matchPsl001("once the per-agent grant PR ships", "x.md");
    expect(out).toHaveLength(1);
  });

  it("matches `will hold a curated set`", () => {
    const out = matchPsl001("This persona will hold a curated set of grants", "x.md");
    expect(out).toHaveLength(1);
  });

  it("matches `tools the role expects to hold once granted`", () => {
    const out = matchPsl001("Tools the role expects to hold once granted: ...", "x.md");
    expect(out).toHaveLength(1);
  });

  it("does not match unrelated text", () => {
    const out = matchPsl001("This persona uses backlog_read and backlog_write tools.", "x.md");
    expect(out).toHaveLength(0);
  });

  // Near-miss negatives — guard against future loosening of the regex
  it("does not match `currently empty` without brackets", () => {
    expect(matchPsl001("the list is currently empty", "x.md")).toHaveLength(0);
  });
  it("does not match `pending assignment` (missing `follow-on`)", () => {
    expect(matchPsl001("the work is pending assignment", "x.md")).toHaveLength(0);
  });
  it("does not match `the per-agent grant` without `once`", () => {
    expect(matchPsl001("the per-agent grant model is...", "x.md")).toHaveLength(0);
  });
  it("does not match `will hold a list` (different framing)", () => {
    expect(matchPsl001("this persona will hold a list of", "x.md")).toHaveLength(0);
  });
  it("does not match `the role expects to hold tools` (missing `once granted`)", () => {
    expect(matchPsl001("the role expects to hold these tools", "x.md")).toHaveLength(0);
  });

  it("reports correct 1-based line number", () => {
    const text = "line one\nline two\ncurrently [] line three\nline four";
    const out = matchPsl001(text, "x.md");
    expect(out[0]!.line).toBe(3);
  });
});
