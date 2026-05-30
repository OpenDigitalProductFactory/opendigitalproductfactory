import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  classifyImageVersion,
  compareImageVersionToSha,
  readImageVersion,
  readSourceContentHash,
} from "./image-version";

function makeTempVersionFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "dpf-image-version-test-"));
  const path = join(dir, ".dpf-image-version");
  writeFileSync(path, contents);
  return path;
}

function makeTempHashFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "dpf-source-hash-test-"));
  const path = join(dir, ".dpf-source-content-hash");
  writeFileSync(path, contents);
  return path;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("classifyImageVersion", () => {
  it("identifies a 40-char hex string as a git-sha", () => {
    expect(classifyImageVersion("0ef4ee02f5131e759a9462076d30449995c66655")).toBe("git-sha");
  });

  it("identifies a 64-char hex string as a content-hash", () => {
    const hash = "a".repeat(64);
    expect(classifyImageVersion(hash)).toBe("content-hash");
  });

  it("treats arbitrary strings (release tags, dev markers) as unknown", () => {
    expect(classifyImageVersion("v0.4.2")).toBe("unknown");
    expect(classifyImageVersion("dev")).toBe("unknown");
    expect(classifyImageVersion("")).toBe("unknown");
  });

  it("rejects non-hex characters even at correct lengths", () => {
    const fortyChars = "z".repeat(40);
    expect(classifyImageVersion(fortyChars)).toBe("unknown");
  });
});

describe("readImageVersion", () => {
  it("returns the trimmed value with a classified source when the file is present", async () => {
    const path = makeTempVersionFile("0ef4ee02f5131e759a9462076d30449995c66655\n");
    try {
      const result = await readImageVersion(path);
      expect(result).toEqual({
        raw: "0ef4ee02f5131e759a9462076d30449995c66655",
        source: "git-sha",
      });
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("classifies a content-hash version correctly", async () => {
    const hash = "f".repeat(64);
    const path = makeTempVersionFile(`${hash}\n`);
    try {
      const result = await readImageVersion(path);
      expect(result?.source).toBe("content-hash");
      expect(result?.raw).toBe(hash);
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("returns null when the file is missing", async () => {
    const result = await readImageVersion("/tmp/this-file-should-not-exist-dpf-test");
    expect(result).toBeNull();
  });

  it("returns null when the file is empty (post-trim)", async () => {
    const path = makeTempVersionFile("   \n\n");
    try {
      const result = await readImageVersion(path);
      expect(result).toBeNull();
    } finally {
      rmSync(path, { force: true });
    }
  });
});

describe("readSourceContentHash", () => {
  it("returns the trimmed content hash when the marker is present", async () => {
    const hash = "b".repeat(64);
    const path = makeTempHashFile(`${hash}\n`);
    try {
      expect(await readSourceContentHash(path)).toBe(hash);
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("returns null when the marker is missing (dev/test/pre-marker images)", async () => {
    expect(
      await readSourceContentHash("/tmp/this-source-hash-should-not-exist-dpf-test"),
    ).toBeNull();
  });

  it("returns null when the marker is empty post-trim", async () => {
    const path = makeTempHashFile("  \n");
    try {
      expect(await readSourceContentHash(path)).toBeNull();
    } finally {
      rmSync(path, { force: true });
    }
  });
});

describe("compareImageVersionToSha", () => {
  const sha = "0ef4ee02f5131e759a9462076d30449995c66655";

  it("reports match when image source is git-sha and value equals expected", () => {
    expect(
      compareImageVersionToSha({ raw: sha, source: "git-sha" }, sha),
    ).toEqual({ match: true, reason: "match" });
  });

  it("matches case-insensitively for git-sha sources", () => {
    expect(
      compareImageVersionToSha({ raw: sha.toUpperCase(), source: "git-sha" }, sha),
    ).toEqual({ match: true, reason: "match" });
  });

  it("reports drift when image is a different git-sha", () => {
    const other = "1".repeat(40);
    expect(
      compareImageVersionToSha({ raw: other, source: "git-sha" }, sha),
    ).toEqual({ match: false, reason: "drift" });
  });

  it("reports incomparable-source when image was stamped with a content hash", () => {
    expect(
      compareImageVersionToSha({ raw: "f".repeat(64), source: "content-hash" }, sha),
    ).toEqual({ match: false, reason: "incomparable-source" });
  });

  it("reports missing when no image version is available", () => {
    expect(compareImageVersionToSha(null, sha)).toEqual({ match: false, reason: "missing" });
  });
});
