import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  emptyAndNullRows,
  flakySucceedsOnAttempt,
  oversizedPayload,
  partialSourceTree,
  twoInstallIdentities,
} from "./index";

describe("partialSourceTree", () => {
  it("models the BI-EE2B243D shape by default: available-looking root, no .git, cited file absent", () => {
    const { root, citedFilePath } = partialSourceTree();
    expect(existsSync(join(root, "package.json"))).toBe(true);
    expect(existsSync(join(root, ".git"))).toBe(false);
    expect(existsSync(join(root, ...citedFilePath.split("/")))).toBe(false);
  });

  it("produces the healthy control shape on demand", () => {
    const { root, citedFilePath } = partialSourceTree({ withGit: true, withFile: true });
    expect(existsSync(join(root, ".git"))).toBe(true);
    expect(existsSync(join(root, ...citedFilePath.split("/")))).toBe(true);
  });
});

describe("twoInstallIdentities", () => {
  it("mints pairwise-independent ids — no shared linkId fixture", () => {
    const { a, b } = twoInstallIdentities();
    expect(a.linkId).not.toBe(b.linkId);
    expect(a.installId).not.toBe(b.installId);
  });
});

describe("oversizedPayload", () => {
  it("is exactly the requested size and deterministic", () => {
    const p = oversizedPayload(1024 * 1024 + 7);
    expect(p.length).toBe(1024 * 1024 + 7);
    expect(p).toBe(oversizedPayload(1024 * 1024 + 7));
  });

  it("rejects nonsense sizes", () => {
    expect(() => oversizedPayload(-1)).toThrow();
    expect(() => oversizedPayload(1.5)).toThrow();
  });
});

describe("flakySucceedsOnAttempt", () => {
  it("rejects transiently then succeeds on attempt n", async () => {
    const fn = flakySucceedsOnAttempt(3, { value: 42 });
    await expect(fn()).rejects.toThrow(/transient/);
    await expect(fn()).rejects.toThrow(/transient/);
    await expect(fn()).resolves.toBe(42);
    expect(fn.attempts).toBe(3);
  });

  it("n=1 succeeds immediately (the healthy control)", async () => {
    await expect(flakySucceedsOnAttempt(1)()).resolves.toBe("ok");
  });
});

describe("emptyAndNullRows", () => {
  it("produces null, empty-string, and each-field-null variants of the shape", () => {
    const shape = { name: "widget", body: "text", count: 3 };
    const rows = emptyAndNullRows(shape);
    expect(rows.allNull).toEqual({ name: null, body: null, count: null });
    expect(rows.emptyStrings).toEqual({ name: "", body: "", count: null });
    expect(rows.eachFieldNull).toHaveLength(3);
    expect(rows.eachFieldNull[0]).toEqual({ name: null, body: "text", count: 3 });
    // populated + allNull + emptyStrings + one per field
    expect(rows.rows).toHaveLength(3 + 3);
  });
});
