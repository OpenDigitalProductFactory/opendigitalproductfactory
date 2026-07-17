// apps/web/lib/platform-config/platform-dev-config-core.test.ts
//
// Unit tests for the pure platform-dev-config domain helpers extracted from
// lib/actions/platform-dev-config.ts (BI-OPT-FAT-ACTIONS, platform-dev-config
// slice). These functions are side-effect-free (no prisma / auth / Next.js /
// fs / fetch), so they are exercised directly here.
import { describe, it, expect } from "vitest";
import {
  detectAuthMethod,
  parseScopesHeader,
  scopeSatisfies,
  parseExpiryHeader,
  shellQuote,
  gitErrorText,
  isMissingGitReferenceError,
} from "./platform-dev-config-core";

describe("detectAuthMethod", () => {
  it("maps known GitHub token prefixes to their auth method", () => {
    expect(detectAuthMethod("gho_abc")).toBe("oauth-device");
    expect(detectAuthMethod("github_pat_abc")).toBe("fine-grained-pat");
    expect(detectAuthMethod("ghp_abc")).toBe("classic-pat");
  });

  it("returns null for unrecognized / installation / refresh prefixes", () => {
    expect(detectAuthMethod("ghs_abc")).toBeNull();
    expect(detectAuthMethod("ghr_abc")).toBeNull();
    expect(detectAuthMethod("not-a-token")).toBeNull();
    expect(detectAuthMethod("")).toBeNull();
  });
});

describe("parseScopesHeader", () => {
  it("returns an empty set for null / empty input", () => {
    expect(parseScopesHeader(null).size).toBe(0);
    expect(parseScopesHeader("").size).toBe(0);
  });

  it("splits on commas, trims, and drops empty entries", () => {
    const scopes = parseScopesHeader(" repo , read:org ,, workflow ");
    expect([...scopes].sort()).toEqual(["read:org", "repo", "workflow"]);
  });
});

describe("scopeSatisfies", () => {
  it("is satisfied when no scope is required", () => {
    expect(scopeSatisfies(new Set(), undefined)).toBe(true);
  });

  it("treats 'repo' as satisfying any required scope (superset)", () => {
    expect(scopeSatisfies(new Set(["repo"]), "public_repo")).toBe(true);
    expect(scopeSatisfies(new Set(["repo"]), "contents:write")).toBe(true);
  });

  it("matches an exact required scope", () => {
    expect(scopeSatisfies(new Set(["public_repo"]), "public_repo")).toBe(true);
  });

  it("fails when the required scope is absent", () => {
    expect(scopeSatisfies(new Set(["read:org"]), "public_repo")).toBe(false);
    expect(scopeSatisfies(new Set(), "repo")).toBe(false);
  });
});

describe("parseExpiryHeader", () => {
  it("returns null for null or unparseable input", () => {
    expect(parseExpiryHeader(null)).toBeNull();
    expect(parseExpiryHeader("not-a-date")).toBeNull();
  });

  it("parses a valid date header into a Date", () => {
    const parsed = parseExpiryHeader("2026-04-24T00:00:00Z");
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed?.toISOString()).toBe("2026-04-24T00:00:00.000Z");
  });
});

describe("shellQuote", () => {
  it("wraps a plain value in single quotes", () => {
    expect(shellQuote("/workspace")).toBe("'/workspace'");
  });

  it("escapes embedded single quotes with the POSIX close-escape-reopen idiom", () => {
    expect(shellQuote("a'b")).toBe("'a'\\''b'");
  });
});

describe("gitErrorText", () => {
  it("delegates non-object values to getErrorMessage", () => {
    expect(gitErrorText("boom")).toBe("boom");
    expect(gitErrorText(new Error("nope"))).toBe("nope");
    expect(gitErrorText(null)).toBe("null");
  });

  it("joins the non-empty message/stderr/stdout fields of an error object", () => {
    expect(gitErrorText({ message: "m", stderr: "e", stdout: "o" })).toBe("m\ne\no");
    expect(gitErrorText({ stderr: "just stderr" })).toBe("just stderr");
  });

  it("drops blank / non-string fields", () => {
    expect(gitErrorText({ message: "", stderr: "   ", stdout: "kept" })).toBe("kept");
    expect(gitErrorText({ message: 42, stderr: "kept" })).toBe("kept");
  });
});

describe("isMissingGitReferenceError", () => {
  it("is true when the error text names the ref and a missing-reference token", () => {
    expect(
      isMissingGitReferenceError(
        { stderr: "error: pathspec 'dpf-upstream' did not match any file(s) known to git" },
        "dpf-upstream",
      ),
    ).toBe(true);
    expect(
      isMissingGitReferenceError({ message: "fatal: unknown revision my-changes" }, "my-changes"),
    ).toBe(true);
  });

  it("is case-insensitive on the ref name", () => {
    expect(
      isMissingGitReferenceError({ stderr: "pathspec 'DPF-UPSTREAM' did not match" }, "dpf-upstream"),
    ).toBe(true);
  });

  it("is false when the ref is present but no missing-reference token is", () => {
    expect(
      isMissingGitReferenceError({ stderr: "dpf-upstream: some other failure" }, "dpf-upstream"),
    ).toBe(false);
  });

  it("is false when the ref name is absent from the text", () => {
    expect(
      isMissingGitReferenceError({ stderr: "pathspec did not match" }, "dpf-upstream"),
    ).toBe(false);
  });
});
