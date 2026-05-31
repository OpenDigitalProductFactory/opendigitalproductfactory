import { describe, expect, it } from "vitest";

import { categoryFor, parseCommit, parseCommits } from "./conventional";
import type { RawCommit } from "./types";

function raw(subject: string, overrides: Partial<RawCommit> = {}): RawCommit {
  return {
    sha: "0000000000000000000000000000000000000000",
    subject,
    author: "Test",
    authorDate: "2026-05-01T00:00:00Z",
    files: [],
    ...overrides,
  };
}

describe("categoryFor", () => {
  it("breaking trumps the type bucket", () => {
    expect(categoryFor("feat", true)).toBe("breaking");
    expect(categoryFor("fix", true)).toBe("breaking");
  });
  it("maps feat/fix/perf to their buckets and the rest to other", () => {
    expect(categoryFor("feat", false)).toBe("feature");
    expect(categoryFor("fix", false)).toBe("fix");
    expect(categoryFor("perf", false)).toBe("performance");
    expect(categoryFor("refactor", false)).toBe("other");
    expect(categoryFor("docs", false)).toBe("other");
    expect(categoryFor("chore", false)).toBe("other");
    expect(categoryFor("unknown", false)).toBe("other");
  });
});

describe("parseCommit", () => {
  it("parses type, scope, breaking, description, and PR number from a DPF-shaped subject", () => {
    const parsed = parseCommit(raw("feat(self-upgrade)!: ship merge-based source prep (#1272)"));
    expect(parsed).toMatchObject({
      type: "feat",
      scope: "self-upgrade",
      breaking: true,
      description: "ship merge-based source prep",
      prNumber: 1272,
      category: "breaking",
    });
  });

  it("handles scope-less subjects", () => {
    const parsed = parseCommit(raw("fix: settings page reflects the org's applied profile"));
    expect(parsed.type).toBe("fix");
    expect(parsed.scope).toBeNull();
    expect(parsed.breaking).toBe(false);
    expect(parsed.category).toBe("fix");
    expect(parsed.description).toBe("settings page reflects the org's applied profile");
    expect(parsed.prNumber).toBeNull();
  });

  it("preserves multi-word scopes like (web,infra)", () => {
    const parsed = parseCommit(raw("feat(web,infra): Health tab full observability coverage (#1355)"));
    expect(parsed.scope).toBe("web,infra");
    expect(parsed.prNumber).toBe(1355);
  });

  it("falls back to type=unknown and full subject for non-Conventional lines", () => {
    const parsed = parseCommit(raw("Updated some stuff because reasons"));
    expect(parsed.type).toBe("unknown");
    expect(parsed.scope).toBeNull();
    expect(parsed.breaking).toBe(false);
    expect(parsed.category).toBe("other");
    expect(parsed.description).toBe("Updated some stuff because reasons");
  });

  it("strips PR ref from description but keeps it on prNumber", () => {
    const parsed = parseCommit(raw("docs: add note (#999)"));
    expect(parsed.description).toBe("add note");
    expect(parsed.prNumber).toBe(999);
  });

  it("recognises unknown types as `unknown` rather than crashing", () => {
    const parsed = parseCommit(raw("blorp(thing): mystery change"));
    expect(parsed.type).toBe("unknown");
    expect(parsed.category).toBe("other");
  });

  it("parseCommits is the bulk wrapper", () => {
    const out = parseCommits([raw("feat: a"), raw("fix: b")]);
    expect(out.map((c) => c.category)).toEqual(["feature", "fix"]);
  });
});
