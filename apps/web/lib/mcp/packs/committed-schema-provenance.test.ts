// Regression for the defect this tool SHIPPED WITH.
//
// Live call 2026-08-23 from an external CLI session:
//   describe_committed_model({ model_name: "MileageRate" })
//   -> "No model named MileageRate ... on unknown branch @ unknown sha"
//   -> trust.tier "high", overallScore 0.99
//   -> freshness rationale: 'Schema was read from "unknown", the default branch.'
//
// MileageRate IS on main. The portal container has no git, so branch and
// headSha resolve to null on EVERY production call — and null fell through to
// full freshness marks, producing a confident wrong answer at high trust from a
// tree the tool could not identify. That is the exact false-absence failure the
// tool exists to prevent.
//
// The original suite passed `readGit: async () => "main"` and never exercised
// the null path, so it was green against a value production never carries —
// the same error class as a test pinned to an archetype no page uses.
import { describe, it, expect, vi, afterEach } from "vitest";

import { loadCommittedSchema } from "./committed-schema-source";

const readdir = vi.fn();
const readFile = vi.fn();

vi.mock("@/lib/shared/lazy-node", () => ({
  lazyFsPromises: () => ({ readdir, readFile }),
  lazyPath: () => ({ resolve: (...p: string[]) => p.join("/") }),
  lazyExec: () => async () => {
    throw new Error("no git in this fixture");
  },
  getCwd: () => "/cwd",
}));

afterEach(() => vi.clearAllMocks());

/** What production actually gets: a container with no git available. */
const noGit = async () => null;

async function load() {
  readdir.mockResolvedValueOnce(["a.prisma"]);
  readFile.mockResolvedValueOnce("model User {}");
  // Explicit: git refused AND .git/HEAD was unreadable. Relying on the fs mock
  // running out of queued values would make this pass by accident.
  return loadCommittedSchema({ skipDefaultBranch: true, readGit: noGit, readBranchFallback: async () => null });
}

describe("committed schema — unidentifiable tree", () => {
  it("does NOT assert that the unidentified tree IS the default branch", async () => {
    const r = await load();
    const freshness = r!.trust.dimensions.find((d) => d.key === "freshness");
    // The shipped bug rendered: 'Schema was read from "unknown", the default branch.'
    // Telling the caller to CONFIRM against the default branch is correct and
    // must stay; asserting this tree is it, is the defect.
    expect(freshness!.rationale).not.toMatch(/read from\s+"?[^"]*"?,\s*the default branch/);
    expect(freshness!.rationale).toMatch(/could\s+NOT be determined/);
    expect(freshness!.rationale).toMatch(/INCONCLUSIVE/);
  });

  it("does NOT score unknown provenance at full freshness", async () => {
    const r = await load();
    const freshness = r!.trust.dimensions.find((d) => d.key === "freshness");
    expect(freshness!.score).toBeLessThanOrEqual(0.4);
  });

  it("does not present an unidentified tree as high trust", async () => {
    const r = await load();
    expect(r!.trust.tier).not.toBe("high");
    expect(r!.trust.action).not.toBe("present");
  });

  it("marks the read inconclusive so a miss cannot be reported as an absence", async () => {
    const r = await load();
    expect(r!.provenance.identified).toBe(false);
  });

  it("still identifies a real branch normally", async () => {
    readdir.mockResolvedValueOnce(["a.prisma"]);
    readFile.mockResolvedValueOnce("model User {}");
    const r = await loadCommittedSchema({
      skipDefaultBranch: true,
      readGit: async () => "main",
      readBranchFallback: async () => null,
    });
    expect(r!.provenance.identified).toBe(true);
    expect(r!.trust.dimensions.find((d) => d.key === "freshness")!.score).toBe(1);
  });
});

// The live condition: git is installed but every call fails with
// "detected dubious ownership", so readGit yields null. .git/HEAD is still a
// plain readable file naming the branch, and recovering it is strictly better
// than reporting an unidentifiable tree.
describe("committed schema — .git/HEAD provenance fallback", () => {
  it("recovers the branch when git refuses, and caps it as off-default", async () => {
    readdir.mockResolvedValueOnce(["a.prisma"]);
    readFile.mockResolvedValueOnce("model User {}");

    const r = await loadCommittedSchema({
      readGit: noGit,
      readBranchFallback: async () => "client/5727856b-3296-4e17-97f0-c59401ace4f2",
    });

    expect(r!.provenance.identified).toBe(true);
    expect(r!.provenance.branch).toBe("client/5727856b-3296-4e17-97f0-c59401ace4f2");
    const freshness = r!.trust.dimensions.find((d) => d.key === "freshness");
    // Named side branch: capped, and NAMED in the rationale.
    expect(freshness!.score).toBeLessThanOrEqual(0.4);
    expect(freshness!.rationale).toContain("client/5727856b");
    expect(freshness!.rationale).toMatch(/not the default branch/);
    expect(r!.trust.tier).not.toBe("high");
  });
});
