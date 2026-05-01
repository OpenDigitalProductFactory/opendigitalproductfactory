import { describe, it, expect } from "vitest";
import { matchPsl001, matchPsl002, matchPsl003, matchPsl004 } from "./audit-prompt-state-leakage";

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

describe("PSL-002 unsourced grant enumeration", () => {
  const goodSection =
    "# Tools Available\n\n" +
    "From `packages/db/data/agent_registry.json`:\n\n" +
    "- backlog_read — read backlog\n" +
    "- backlog_write — author backlog items\n";

  const badSection =
    "# Tools Available\n\n" +
    "This agent uses these grants once the PR ships:\n\n" +
    "- backlog_read — read backlog\n" +
    "- backlog_write — author backlog items\n";

  const noBulletsSection =
    "# Tools Available\n\n" +
    "Refer to the registry for the live list.\n";

  it("flags a Tools Available section with grant bullets and no source citation", () => {
    const out = matchPsl002(badSection, "x.md");
    expect(out).toHaveLength(1);
    expect(out[0]!.invariantId).toBe("PSL-002");
  });

  it("does not flag a Tools Available section that cites packages/db/data/agent_registry.json", () => {
    const out = matchPsl002(goodSection, "x.md");
    expect(out).toHaveLength(0);
  });

  it("does not flag a Tools Available section without grant-like bullets", () => {
    const out = matchPsl002(noBulletsSection, "x.md");
    expect(out).toHaveLength(0);
  });

  it("flags a Tool Use section the same way", () => {
    const text = badSection.replace("# Tools Available", "# Tool Use");
    const out = matchPsl002(text, "x.md");
    expect(out).toHaveLength(1);
  });

  it("does not accept seed.ts as the sole citation", () => {
    const text = badSection.replace(
      "This agent uses these grants once the PR ships:",
      "Mirroring `packages/db/src/seed.ts`:",
    );
    const out = matchPsl002(text, "x.md");
    expect(out).toHaveLength(1);
  });

  it("flags indented sub-bullets with grant suffixes", () => {
    const indented =
      "# Tools Available\n\n" +
      "Some narrative here:\n\n" +
      "  - backlog_read — read backlog\n" +
      "  - backlog_write — author backlog items\n";
    const out = matchPsl002(indented, "x.md");
    expect(out).toHaveLength(1);
  });
});

describe("PSL-003 current-state grant snapshots", () => {
  it('matches `currently ["foo","bar"]`', () => {
    const out = matchPsl003('the grants are currently ["backlog_read","sandbox_execute"]', "x.md");
    expect(out).toHaveLength(1);
  });

  it("matches `currently holds`", () => {
    const out = matchPsl003("This agent currently holds backlog_read", "x.md");
    expect(out).toHaveLength(1);
  });

  it("matches `you currently have`", () => {
    const out = matchPsl003("You currently have these grants:", "x.md");
    expect(out).toHaveLength(1);
  });

  it("matches `grants you currently hold`", () => {
    const out = matchPsl003("List of grants you currently hold:", "x.md");
    // Multiple patterns may legitimately match this line (the dedicated
    // `grants you currently hold` regex AND the broader `currently holds?`).
    // Both are valid findings; assert at least one fires with the expected
    // phrase content.
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out.some((f) => f.match.toLowerCase().includes("currently hold"))).toBe(true);
  });

  it("does not match a citation that says PAGE DATA is authoritative", () => {
    const text =
      "Tool list is delivered by the runtime via PAGE DATA. The registry path is a non-authoritative reference; you currently have whatever PAGE DATA shows.";
    const out = matchPsl003(text, "x.md");
    expect(out).toHaveLength(0);
  });
});

describe("PSL-004 runtime-disabling instruction", () => {
  it("warns on `do not use X tools because they are pending`", () => {
    const out = matchPsl004("Do not use sandbox tools because they are pending grant assignment.", "x.md");
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe("warn");
  });

  it("warns on `aspirational` framing without runtime evidence pointer", () => {
    const out = matchPsl004("These tool grants are currently aspirational.", "x.md");
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe("warn");
  });

  it("does not warn when the line points at runtime evidence", () => {
    const out = matchPsl004(
      "These tool grants are currently aspirational; check the runtime tool list (PAGE DATA) for what is actually delivered.",
      "x.md",
    );
    expect(out).toHaveLength(0);
  });
});
