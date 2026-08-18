import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { isEntryModule } from "./entry-module.mjs";

test("isEntryModule matches when argv[1] is the exact entry path", () => {
  const temp = mkdtempSync(join(tmpdir(), "dpf-entry-module-"));
  try {
    const script = join(temp, "script.mjs");
    writeFileSync(script, "export {};\n");
    assert.equal(isEntryModule(pathToFileURL(script).href, script), true);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("isEntryModule matches when argv[1] reaches the entry through a symlink", () => {
  const temp = mkdtempSync(join(tmpdir(), "dpf-entry-module-"));
  try {
    const script = join(temp, "script.mjs");
    writeFileSync(script, "export {};\n");
    const link = join(temp, "link.mjs");
    symlinkSync(script, link);
    // The loader hands import.meta.url the real path while the caller typed
    // the symlink — the exact macOS /var vs /private/var tmpdir shape.
    assert.equal(isEntryModule(pathToFileURL(script).href, link), true);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("isEntryModule rejects a different file and a missing argv path", () => {
  const temp = mkdtempSync(join(tmpdir(), "dpf-entry-module-"));
  try {
    const script = join(temp, "script.mjs");
    const other = join(temp, "other.mjs");
    writeFileSync(script, "export {};\n");
    writeFileSync(other, "export {};\n");
    assert.equal(isEntryModule(pathToFileURL(script).href, other), false);
    assert.equal(isEntryModule(pathToFileURL(script).href, undefined), false);
    assert.equal(isEntryModule(pathToFileURL(script).href, join(temp, "gone.mjs")), false);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
