import { describe, expect, it, vi } from "vitest";
import {
  ancestryFailureDetail,
  classifyGitAncestryFailure,
  gitRepoRootCandidates,
  resolveGitAncestry,
  shasEqualOrPrefix,
} from "./git-ancestry";

describe("shasEqualOrPrefix", () => {
  it("matches exact full SHAs case-insensitively", () => {
    const full = "a1b2c3d4e5f6789012345678abcdef0123456789";
    expect(shasEqualOrPrefix(full, full.toUpperCase())).toBe(true);
  });

  it("matches abbreviated vs full in either direction", () => {
    const full = "a1b2c3d4e5f6789012345678abcdef0123456789";
    expect(shasEqualOrPrefix(full.slice(0, 12), full)).toBe(true);
    expect(shasEqualOrPrefix(full, full.slice(0, 7))).toBe(true);
  });

  it("rejects unrelated SHAs and empty", () => {
    expect(shasEqualOrPrefix("aaaaaaaa", "bbbbbbbb")).toBe(false);
    expect(shasEqualOrPrefix("", "aaaaaaa")).toBe(false);
    expect(shasEqualOrPrefix("not-a-sha!", "also-not")).toBe(false);
  });
});

describe("classifyGitAncestryFailure", () => {
  it("maps exit code 1 to not-ancestor", () => {
    expect(classifyGitAncestryFailure({ code: 1 })).toBe("not-ancestor");
  });

  it("maps missing-object messages", () => {
    expect(
      classifyGitAncestryFailure({
        code: 128,
        stderr: "fatal: Not a valid object name abc1234",
      }),
    ).toBe("missing-object");
  });

  it("maps no-repo messages", () => {
    expect(
      classifyGitAncestryFailure({
        code: 128,
        message: "fatal: not a git repository (or any of the parent directories)",
      }),
    ).toBe("no-repo");
  });

  it("maps missing git binary", () => {
    expect(classifyGitAncestryFailure({ code: "ENOENT", message: "spawn git ENOENT" })).toBe(
      "no-git",
    );
  });
});

describe("ancestryFailureDetail", () => {
  it("mentions DPF_REPO_ROOT for no-repo and missing-object", () => {
    expect(ancestryFailureDetail("no-repo")).toMatch(/DPF_REPO_ROOT/);
    expect(ancestryFailureDetail("missing-object")).toMatch(/DPF_REPO_ROOT|git fetch/i);
  });
});

describe("gitRepoRootCandidates", () => {
  it("prefers DPF_REPO_ROOT then well-known portal mounts then cwd (BI-1D55A2AD)", () => {
    expect(
      gitRepoRootCandidates(
        { DPF_REPO_ROOT: "/clone", DPF_GIT_WORK_TREE: "/clone" } as unknown as NodeJS.ProcessEnv,
        "/cwd",
      ),
    ).toEqual(["/clone", "/host-dpf", "/host-source", "/workspace", "/cwd"]);
  });

  it("derives work tree from GIT_DIR ending in .git", () => {
    expect(
      gitRepoRootCandidates(
        { GIT_DIR: "/clone/.git" } as unknown as NodeJS.ProcessEnv,
        "/cwd",
      ),
    ).toEqual(["/clone", "/host-dpf", "/host-source", "/workspace", "/cwd"]);
  });

  it("includes PROJECT_ROOT and does not depend on cwd being the repo", () => {
    const roots = gitRepoRootCandidates(
      { PROJECT_ROOT: "/app-project" } as unknown as NodeJS.ProcessEnv,
      "/app",
    );
    expect(roots[0]).toBe("/app-project");
    expect(roots).toContain("/host-dpf");
    expect(roots).toContain("/app");
  });
});

describe("resolveGitAncestry", () => {
  it("short-circuits on equal/prefix SHAs without calling git", async () => {
    const run = vi.fn();
    const full = "abcdef0123456789abcdef0123456789abcdef01";
    const r = await resolveGitAncestry(full.slice(0, 10), full, { run });
    expect(r.contained).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it("returns true when merge-base --is-ancestor succeeds in a candidate root", async () => {
    const run = vi.fn(async (args: string[], cwd: string) => {
      if (args[0] === "rev-parse") {
        return cwd === "/good" ? { ok: true as const, stdout: "true\n" } : { ok: false as const, err: { code: 128, message: "not a git repository" } };
      }
      // merge-base
      return cwd === "/good" ? { ok: true as const, stdout: "" } : { ok: false as const, err: { code: 1 } };
    });
    const r = await resolveGitAncestry("aaaaaaaa", "bbbbbbbb", {
      env: { DPF_REPO_ROOT: "/good" } as unknown as NodeJS.ProcessEnv,
      cwd: "/bad",
      run: run as never,
    });
    expect(r.contained).toBe(true);
    expect(r.repoRoot).toBe("/good");
  });

  it("returns false when merge-base exits 1 (not ancestor)", async () => {
    const run = vi.fn(async (args: string[]) => {
      if (args[0] === "rev-parse") return { ok: true as const, stdout: "true\n" };
      return { ok: false as const, err: { code: 1 } };
    });
    const r = await resolveGitAncestry("aaaaaaaa", "bbbbbbbb", {
      cwd: "/repo",
      run: run as never,
    });
    expect(r.contained).toBe(false);
    expect(r.failureKind).toBe("not-ancestor");
  });

  it("returns null + failureKind when no root can compute ancestry", async () => {
    const run = vi.fn(async () => ({
      ok: false as const,
      err: { code: 128, stderr: "fatal: not a git repository" },
    }));
    const r = await resolveGitAncestry("aaaaaaaa", "bbbbbbbb", {
      cwd: "/nowhere",
      env: {} as unknown as NodeJS.ProcessEnv,
      run: run as never,
    });
    expect(r.contained).toBe(null);
    expect(r.failureKind).toBe("no-repo");
  });
});
