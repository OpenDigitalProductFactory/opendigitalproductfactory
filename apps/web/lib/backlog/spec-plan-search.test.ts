import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetSpecPlanCachesForTests, searchSpecsAndPlans } from "./spec-plan-search";

let tmpRoot: string;
let originalCwd: string;

async function writeFixture(rel: string, body: string): Promise<void> {
  const abs = path.join(tmpRoot, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body, "utf-8");
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spec-plan-search-"));
  originalCwd = process.cwd();
  process.chdir(tmpRoot);
  _resetSpecPlanCachesForTests();
});

afterEach(async () => {
  process.chdir(originalCwd);
  _resetSpecPlanCachesForTests();
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("searchSpecsAndPlans", () => {
  it("finds a spec by title text and returns a snippet around the match", async () => {
    await writeFixture(
      "docs/superpowers/specs/2026-04-25-governed-mcp-backlog-surface-design.md",
      "# Governed MCP Backlog Surface — Design Spec\n\nLong body text that has the keyword somewhere here. Lots of context around it.",
    );
    const results = await searchSpecsAndPlans({ query: "keyword" });
    expect(results).toHaveLength(1);
    expect(results[0]!.kind).toBe("spec");
    expect(results[0]!.title).toBe("Governed MCP Backlog Surface — Design Spec");
    expect(results[0]!.date).toBe("2026-04-25");
    expect(results[0]!.snippet).toContain("keyword");
  });

  it("filters by kind=plan", async () => {
    await writeFixture(
      "docs/superpowers/specs/2026-04-25-foo-design.md",
      "# Foo\n\nfoo keyword here",
    );
    await writeFixture(
      "docs/superpowers/plans/2026-04-25-foo.md",
      "# Foo Plan\n\nfoo keyword here",
    );
    const results = await searchSpecsAndPlans({ query: "keyword", kind: "plan" });
    expect(results).toHaveLength(1);
    expect(results[0]!.kind).toBe("plan");
  });

  it("extracts referenced backlog and epic IDs", async () => {
    await writeFixture(
      "docs/superpowers/specs/2026-04-25-x-design.md",
      "# X\n\nThis touches BI-PORT-001 and BI-FOO-9 and EP-BUILD-9F749C and BI-PORT-001 again.",
    );
    const [r] = await searchSpecsAndPlans({ query: "touches" });
    expect(r!.referencedItemIds).toEqual(["BI-FOO-9", "BI-PORT-001"]);
    expect(r!.referencedEpicIds).toEqual(["EP-BUILD-9F749C"]);
  });

  it("matches by itemId when query alone misses", async () => {
    await writeFixture(
      "docs/superpowers/specs/2026-04-25-x-design.md",
      "# X\n\nThis spec covers BI-PORT-001 work.",
    );
    const results = await searchSpecsAndPlans({
      query: "nothing-matches-here",
      itemId: "BI-PORT-001",
    });
    expect(results).toHaveLength(1);
  });

  it("matches by epicId when query alone misses", async () => {
    await writeFixture(
      "docs/superpowers/plans/2026-04-25-x.md",
      "# Y\n\nPart of EP-LAB-6A91C2.",
    );
    const results = await searchSpecsAndPlans({
      query: "nope",
      epicId: "EP-LAB-6A91C2",
    });
    expect(results).toHaveLength(1);
  });

  it("respects matches cap", async () => {
    for (let i = 0; i < 12; i++) {
      await writeFixture(
        `docs/superpowers/specs/2026-04-${String(i + 1).padStart(2, "0")}-spec-${i}-design.md`,
        `# Spec ${i}\n\nkeyword ${i}`,
      );
    }
    const results = await searchSpecsAndPlans({ query: "keyword", matches: 5 });
    expect(results).toHaveLength(5);
  });

  it("clamps matches above MAX_MATCHES", async () => {
    for (let i = 0; i < 30; i++) {
      await writeFixture(
        `docs/superpowers/specs/2026-04-${String((i % 28) + 1).padStart(2, "0")}-x${i}-design.md`,
        `# x${i}\n\nkeyword`,
      );
    }
    const results = await searchSpecsAndPlans({ query: "keyword", matches: 1000 });
    expect(results.length).toBeLessThanOrEqual(25);
  });

  it("prefers frontmatter title over first H1", async () => {
    await writeFixture(
      "docs/superpowers/specs/2026-04-25-fm-design.md",
      "---\ntitle: Frontmatter Title\n---\n# H1 Title\n\nkeyword",
    );
    const [r] = await searchSpecsAndPlans({ query: "keyword" });
    expect(r!.title).toBe("Frontmatter Title");
  });

  it("falls back to filename when no title found", async () => {
    await writeFixture(
      "docs/superpowers/specs/2026-04-25-bare-design.md",
      "Just plain body with keyword",
    );
    const [r] = await searchSpecsAndPlans({ query: "keyword" });
    expect(r!.title).toBe("2026-04-25-bare-design");
  });

  it("returns empty when nothing matches", async () => {
    await writeFixture("docs/superpowers/specs/2026-04-25-x-design.md", "# X\n\nbody");
    const results = await searchSpecsAndPlans({ query: "absent-needle" });
    expect(results).toEqual([]);
  });

  it("returns empty when target dirs do not exist", async () => {
    const results = await searchSpecsAndPlans({ query: "anything" });
    expect(results).toEqual([]);
  });
});
