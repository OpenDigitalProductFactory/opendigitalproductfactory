import { existsSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { secureTempPath, withSecureTempDir } from "./safe-tempfile";

describe("secureTempPath", () => {
  it("returns a path under os.tmpdir()", () => {
    const p = secureTempPath("dpf-test");
    expect(p.startsWith(tmpdir())).toBe(true);
  });

  it("contains a high-entropy UUID suffix", () => {
    const p = secureTempPath("dpf-test");
    // UUIDv4 regex: 8-4-4-4-12 hex digits with version 4 nibble.
    expect(p).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it("appends the extension when provided", () => {
    const p = secureTempPath("dpf-test", "patch");
    expect(p.endsWith(".patch")).toBe(true);
  });

  it("returns a different path on every call (no predictability)", () => {
    const a = secureTempPath("dpf-test");
    const b = secureTempPath("dpf-test");
    expect(a).not.toBe(b);
  });

  it("does not touch disk", () => {
    const p = secureTempPath("dpf-test-untouched");
    expect(existsSync(p)).toBe(false);
  });
});

describe("withSecureTempDir", () => {
  it("creates a directory and removes it after the callback", async () => {
    let observed = "";
    await withSecureTempDir("dpf-test", async (dir) => {
      observed = dir;
      expect(existsSync(dir)).toBe(true);
      expect(statSync(dir).isDirectory()).toBe(true);
    });
    expect(existsSync(observed)).toBe(false);
  });

  it("cleans up even if the callback throws", async () => {
    let observed = "";
    await expect(
      withSecureTempDir("dpf-test", async (dir) => {
        observed = dir;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(existsSync(observed)).toBe(false);
  });

  it("cleans up directories with file contents", async () => {
    let observed = "";
    await withSecureTempDir("dpf-test", async (dir) => {
      observed = dir;
      await writeFile(`${dir}/inside.txt`, "hello");
      expect(existsSync(`${dir}/inside.txt`)).toBe(true);
    });
    expect(existsSync(observed)).toBe(false);
  });

  it("returns the callback's return value", async () => {
    const result = await withSecureTempDir("dpf-test", async () => 42);
    expect(result).toBe(42);
  });
});
