import { describe, expect, it, vi } from "vitest";

import { buildLogCommand, collectChangeSet, parseGitLogOutput } from "./change-set";

describe("buildLogCommand", () => {
  it("targets the lineage→target range against the configured host clone", () => {
    expect(
      buildLogCommand({
        hostSourcePath: "/host-dpf",
        currentLineageSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        targetSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }),
    ).toEqual([
      "git",
      "-C",
      "/host-dpf",
      "log",
      "--reverse",
      "--no-merges",
      "--name-only",
      expect.stringContaining("%H"),
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa..bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ]);
  });
});

describe("parseGitLogOutput", () => {
  it("parses multi-commit output with file lists per commit", () => {
    const out = [
      "\x1e1111111111111111111111111111111111111111\x1ffeat: a (#1)\x1fAlice\x1f2026-05-01T10:00:00Z",
      "apps/web/foo.ts",
      "packages/db/x.ts",
      "",
      "\x1e2222222222222222222222222222222222222222\x1ffix: b (#2)\x1fBob\x1f2026-05-02T11:00:00Z",
      "scripts/y.sh",
      "",
    ].join("\n");
    const parsed = parseGitLogOutput(out);
    expect(parsed).toEqual([
      {
        sha: "1111111111111111111111111111111111111111",
        subject: "feat: a (#1)",
        author: "Alice",
        authorDate: "2026-05-01T10:00:00Z",
        files: ["apps/web/foo.ts", "packages/db/x.ts"],
      },
      {
        sha: "2222222222222222222222222222222222222222",
        subject: "fix: b (#2)",
        author: "Bob",
        authorDate: "2026-05-02T11:00:00Z",
        files: ["scripts/y.sh"],
      },
    ]);
  });

  it("returns [] for empty output", () => {
    expect(parseGitLogOutput("")).toEqual([]);
    expect(parseGitLogOutput("\n\n")).toEqual([]);
  });

  it("tolerates commits without changed files", () => {
    const out = "\x1eaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\x1fchore: empty\x1fX\x1f2026-05-01T00:00:00Z";
    const parsed = parseGitLogOutput(out);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.files).toEqual([]);
  });
});

describe("collectChangeSet — injectable execFile", () => {
  it("routes the canned git output through the parser", async () => {
    const stdout = "\x1edeadbeefdeadbeefdeadbeefdeadbeefdeadbeef\x1ffeat: c\x1fC\x1f2026-05-03T00:00:00Z\nfile.ts\n";
    const execFile = vi.fn().mockResolvedValue({ stdout });
    const out = await collectChangeSet(
      {
        currentLineageSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        targetSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        config: { hostSourcePath: "/host-dpf" },
      },
      { execFile },
    );
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(1);
    expect(out[0]!.subject).toBe("feat: c");
    expect(out[0]!.files).toEqual(["file.ts"]);
  });
});
