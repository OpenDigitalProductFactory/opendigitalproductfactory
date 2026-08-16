import { describe, expect, it } from "vitest";

import { parseCommit } from "./conventional";
import { refineCategories } from "./refine";
import type { ParsedCommit, PrEnrichment, RawCommit } from "./types";

function raw(subject: string): RawCommit {
  return {
    sha: "0000000000000000000000000000000000000000",
    subject,
    author: "Test",
    authorDate: "2026-05-01T00:00:00Z",
    files: [],
  };
}

function pr(overrides: Partial<PrEnrichment> & { prNumber: number }): PrEnrichment {
  return { title: null, labels: [], body: null, ...overrides };
}

function refineOne(subject: string, enrichment?: PrEnrichment): ParsedCommit {
  const commit = parseCommit(raw(subject));
  const byPr = new Map<number, PrEnrichment>();
  if (enrichment) byPr.set(enrichment.prNumber, enrichment);
  return refineCategories([commit], byPr)[0]!;
}

describe("refineCategories", () => {
  it("promotes a dependency bump carrying a security label", () => {
    const out = refineOne(
      "build(deps): bump nanoid from 5.0.9 to 5.1.6 (#4313)",
      pr({ prNumber: 4313, labels: ["dependencies", "security"] }),
    );
    expect(out.category).toBe("security");
  });

  it("promotes on an advisory id in the PR title", () => {
    const out = refineOne(
      "fix(deps): raise the floor (#4313)",
      pr({ prNumber: 4313, title: "Clear GHSA-4943-9vgg-gr5r in the lockfile" }),
    );
    expect(out.category).toBe("security");
  });

  it("promotes on advisory wording in the commit subject with no PR reachable", () => {
    const out = refineOne("fix(web): patch the session-fixation vulnerability");
    expect(out.category).toBe("security");
  });

  it("leaves a routine bump as a dependency change", () => {
    const out = refineOne(
      "build(deps): bump next from 16.2.12 to 16.3.0 (#4305)",
      pr({ prNumber: 4305, labels: ["dependencies"], title: "Bump next" }),
    );
    expect(out.category).toBe("dependency");
  });

  it("never demotes a breaking change", () => {
    const out = refineOne(
      "feat(api)!: drop the legacy endpoint (#4200)",
      pr({ prNumber: 4200, labels: ["security"] }),
    );
    expect(out.category).toBe("breaking");
  });

  it("leaves an unparseable subject honest as `other`", () => {
    const out = refineOne("Some security-flavoured wording without a CVE");
    expect(out.category).toBe("other");
  });

  it("does not mutate its input", () => {
    const commits = [parseCommit(raw("build(deps): bump x (#1)"))];
    const byPr = new Map([[1, pr({ prNumber: 1, labels: ["security"] })]]);
    const out = refineCategories(commits, byPr);
    expect(commits[0]!.category).toBe("dependency");
    expect(out[0]!.category).toBe("security");
  });
});
