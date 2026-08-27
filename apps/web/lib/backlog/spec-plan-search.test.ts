import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetSpecPlanCachesForTests,
  buildSpecPlanReferenceIndex,
  searchSpecsAndPlans,
  specPlanCorpusCaveat,
} from "./spec-plan-search";

let tmpRoot: string;
let originalCwd: string;
let originalRepoRoot: string | undefined;

async function writeFixture(rel: string, body: string): Promise<void> {
  const abs = path.join(tmpRoot, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, body, "utf-8");
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spec-plan-search-"));
  originalCwd = process.cwd();
  originalRepoRoot = process.env.DPF_REPO_ROOT;
  process.chdir(tmpRoot);
  _resetSpecPlanCachesForTests();
});

afterEach(async () => {
  process.chdir(originalCwd);
  if (originalRepoRoot === undefined) delete process.env.DPF_REPO_ROOT;
  else process.env.DPF_REPO_ROOT = originalRepoRoot;
  _resetSpecPlanCachesForTests();
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("searchSpecsAndPlans", () => {
  it("finds a spec by title text and returns a snippet around the match", async () => {
    await writeFixture(
      "docs/superpowers/specs/2026-04-25-governed-mcp-backlog-surface-design.md",
      "# Governed MCP Backlog Surface — Design Spec\n\nLong body text that has the keyword somewhere here. Lots of context around it.",
    );
    const { results } = await searchSpecsAndPlans({ query: "keyword" });
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
    const { results } = await searchSpecsAndPlans({ query: "keyword", kind: "plan" });
    expect(results).toHaveLength(1);
    expect(results[0]!.kind).toBe("plan");
  });

  it("extracts referenced backlog and epic IDs", async () => {
    await writeFixture(
      "docs/superpowers/specs/2026-04-25-x-design.md",
      "# X\n\nThis touches BI-PORT-001 and BI-FOO-9 and EP-BUILD-9F749C and BI-PORT-001 again.",
    );
    const { results: [r] } = await searchSpecsAndPlans({ query: "touches" });
    expect(r!.referencedItemIds).toEqual(["BI-FOO-9", "BI-PORT-001"]);
    expect(r!.referencedEpicIds).toEqual(["EP-BUILD-9F749C"]);
  });

  it("matches by itemId when query alone misses", async () => {
    await writeFixture(
      "docs/superpowers/specs/2026-04-25-x-design.md",
      "# X\n\nThis spec covers BI-PORT-001 work.",
    );
    const { results } = await searchSpecsAndPlans({
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
    const { results } = await searchSpecsAndPlans({
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
    const { results } = await searchSpecsAndPlans({ query: "keyword", matches: 5 });
    expect(results).toHaveLength(5);
  });

  it("clamps matches above MAX_MATCHES", async () => {
    for (let i = 0; i < 30; i++) {
      await writeFixture(
        `docs/superpowers/specs/2026-04-${String((i % 28) + 1).padStart(2, "0")}-x${i}-design.md`,
        `# x${i}\n\nkeyword`,
      );
    }
    const { results } = await searchSpecsAndPlans({ query: "keyword", matches: 1000 });
    expect(results.length).toBeLessThanOrEqual(25);
  });

  it("prefers frontmatter title over first H1", async () => {
    await writeFixture(
      "docs/superpowers/specs/2026-04-25-fm-design.md",
      "---\ntitle: Frontmatter Title\n---\n# H1 Title\n\nkeyword",
    );
    const { results: [r] } = await searchSpecsAndPlans({ query: "keyword" });
    expect(r!.title).toBe("Frontmatter Title");
  });

  it("falls back to filename when no title found", async () => {
    await writeFixture(
      "docs/superpowers/specs/2026-04-25-bare-design.md",
      "Just plain body with keyword",
    );
    const { results: [r] } = await searchSpecsAndPlans({ query: "keyword" });
    expect(r!.title).toBe("2026-04-25-bare-design");
  });

  it("reports a genuine no-match as an available corpus with zero results", async () => {
    await writeFixture("docs/superpowers/specs/2026-04-25-x-design.md", "# X\n\nbody");
    await writeFixture("docs/superpowers/plans/2026-04-25-x.md", "# X plan\n\nbody");
    const { results, corpus } = await searchSpecsAndPlans({ query: "absent-needle" });
    expect(results).toEqual([]);
    expect(corpus.available).toBe(true);
    expect(corpus.fileCount).toBe(2);
    expect(corpus.missingPaths).toEqual([]);
  });

  // BI-10C34BE1: this is the false negative. A runtime-host install ships no
  // docs/superpowers tree, and the old contract answered with the same bare []
  // that a real no-match produced, so a substrate check read "no prior design
  // exists" and net-new work got proposed over an existing spec.
  it("reports an absent corpus as unavailable rather than as a no-match", async () => {
    const { results, corpus } = await searchSpecsAndPlans({ query: "anything" });
    expect(results).toEqual([]);
    expect(corpus.available).toBe(false);
    expect(corpus.fileCount).toBe(0);
    expect(corpus.missingPaths).toEqual([
      "docs/superpowers/specs",
      "docs/superpowers/plans",
    ]);
    expect(corpus.reason).toContain("docs/superpowers/specs");
    expect(corpus.reason).toContain("DPF_REPO_ROOT");
  });

  it("reports a present-but-empty corpus as unavailable too", async () => {
    await fs.mkdir(path.join(tmpRoot, "docs/superpowers/specs"), { recursive: true });
    await fs.mkdir(path.join(tmpRoot, "docs/superpowers/plans"), { recursive: true });
    const { corpus } = await searchSpecsAndPlans({ query: "anything" });
    expect(corpus.available).toBe(false);
    expect(corpus.missingPaths).toEqual([]);
    expect(corpus.reason).toContain("no markdown files");
  });

  it("scopes corpus availability to the directories the kind filter searched", async () => {
    await writeFixture("docs/superpowers/specs/2026-04-25-x-design.md", "# X\n\nbody");
    const specOnly = await searchSpecsAndPlans({ query: "body", kind: "spec" });
    expect(specOnly.corpus.available).toBe(true);
    expect(specOnly.corpus.searchedPaths).toEqual(["docs/superpowers/specs"]);

    const planOnly = await searchSpecsAndPlans({ query: "body", kind: "plan" });
    expect(planOnly.corpus.available).toBe(false);
    expect(planOnly.corpus.missingPaths).toEqual(["docs/superpowers/plans"]);
  });

  it("prefers the governed self-upgrade workspace over a stale host checkout", async () => {
    const installRoot = path.join(tmpRoot, "host-dpf");
    const deployedRoot = path.join(installRoot, ".upgrade-workspace");
    await writeFixture(
      "host-dpf/docs/superpowers/plans/2026-08-13-stale.md",
      "# Stale root plan\n\nold-only",
    );
    await writeFixture(
      "host-dpf/.upgrade-workspace/docs/superpowers/plans/2026-08-14-deployed.md",
      "# Deployed runtime plan\n\nBI-872048AF runtime evidence",
    );
    process.env.DPF_REPO_ROOT = installRoot;
    const unrelatedRuntimeCwd = path.join(tmpRoot, "unrelated-runtime-cwd");
    await fs.mkdir(unrelatedRuntimeCwd, { recursive: true });
    process.chdir(unrelatedRuntimeCwd);

    const { results } = await searchSpecsAndPlans({ query: "runtime evidence", kind: "plan" });

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("Deployed runtime plan");
    expect(results[0]?.path).toBe("docs/superpowers/plans/2026-08-14-deployed.md");
    expect(results[0]?.sourceRoot).toBe(deployedRoot);
  });
});

describe("buildSpecPlanReferenceIndex", () => {
  it("reports corpus availability so an empty index is not read as 'no item has a spec'", async () => {
    const absent = await buildSpecPlanReferenceIndex();
    expect(absent.specs.size).toBe(0);
    expect(absent.plans.size).toBe(0);
    expect(absent.corpus.available).toBe(false);

    await writeFixture(
      "docs/superpowers/specs/2026-04-25-x-design.md",
      "# X\n\nCovers BI-PORT-001.",
    );
    await writeFixture("docs/superpowers/plans/2026-04-25-x.md", "# X plan\n\nCovers EP-LAB-1.");
    _resetSpecPlanCachesForTests();

    const present = await buildSpecPlanReferenceIndex();
    expect(present.specs.has("BI-PORT-001")).toBe(true);
    expect(present.plans.has("EP-LAB-1")).toBe(true);
    expect(present.corpus.available).toBe(true);
  });
});

describe("specPlanCorpusCaveat", () => {
  it("is null when the corpus is present", async () => {
    await writeFixture("docs/superpowers/specs/2026-04-25-x-design.md", "# X\n\nbody");
    await writeFixture("docs/superpowers/plans/2026-04-25-x.md", "# X\n\nbody");
    const { corpus } = await searchSpecsAndPlans({ query: "body" });
    expect(specPlanCorpusCaveat(corpus)).toBeNull();
  });

  it("tells the caller to treat hasSpec/hasPlan as unknown when the corpus is absent", async () => {
    const { corpus } = await searchSpecsAndPlans({ query: "body" });
    const caveat = specPlanCorpusCaveat(corpus);
    expect(caveat).toContain("NOT measured");
    expect(caveat).toContain("unknown, not as false");
  });
});
