// node --test — convergence contract for the gitignored pre-push shim (BI-C74F4DE9).
import assert from "node:assert/strict";
import { accessSync, constants, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { DELEGATING_SHIM, classifyPrePushShim, ensurePrePushHook } from "./ensure-pre-push-hook.mjs";

const LFS_STOCK = `#!/bin/sh
command -v git-lfs >/dev/null 2>&1 || { printf >&2 "\\n%s\\n\\n" "This repository is configured for Git LFS but 'git-lfs' was not found on your path."; exit 2; }
git lfs pre-push "$@"
`;

// NTFS has no POSIX execute bit: fs.chmodSync(0o755) leaves mode 0o666 and
// `mode & 0o111` is always 0, so asserting exec bits failed on every Windows
// clone (BI-5CBDC146). Git for Windows runs hooks through `sh` and does not
// consult the bit, so the meaningful cross-platform assertion is that the shim
// exists and is readable — with the exec bit still enforced where it exists.
function assertExecutable(path) {
  if (process.platform === "win32") {
    accessSync(path, constants.R_OK);
    return;
  }
  assert.ok(statSync(path).mode & 0o111, "shim must be executable");
}

test("classifyPrePushShim recognizes all four states", () => {
  assert.equal(classifyPrePushShim(null), "missing");
  assert.equal(classifyPrePushShim(LFS_STOCK), "lfs-stock");
  assert.equal(classifyPrePushShim(DELEGATING_SHIM), "delegating");
  assert.equal(classifyPrePushShim("#!/bin/sh\n./my-own-thing\n"), "custom");
});

test("ensurePrePushHook writes the delegating shim when missing, executable", () => {
  const dir = mkdtempSync(join(tmpdir(), "dpf-hook-conv-"));
  const result = ensurePrePushHook(dir);
  assert.deepEqual(result, { action: "written", was: "missing" });
  assert.equal(readFileSync(join(dir, "pre-push"), "utf8"), DELEGATING_SHIM);
  assertExecutable(join(dir, "pre-push"));
});

test("ensurePrePushHook replaces the stock git-lfs shim", () => {
  const dir = mkdtempSync(join(tmpdir(), "dpf-hook-conv-"));
  writeFileSync(join(dir, "pre-push"), LFS_STOCK);
  const result = ensurePrePushHook(dir);
  assert.deepEqual(result, { action: "written", was: "lfs-stock" });
  assert.equal(readFileSync(join(dir, "pre-push"), "utf8"), DELEGATING_SHIM);
});

test("ensurePrePushHook is idempotent on an already-delegating shim", () => {
  const dir = mkdtempSync(join(tmpdir(), "dpf-hook-conv-"));
  ensurePrePushHook(dir);
  const result = ensurePrePushHook(dir);
  assert.deepEqual(result, { action: "unchanged", was: "delegating" });
});

test("ensurePrePushHook never clobbers a custom hook", () => {
  const dir = mkdtempSync(join(tmpdir(), "dpf-hook-conv-"));
  const custom = "#!/bin/sh\n./my-own-thing\n";
  writeFileSync(join(dir, "pre-push"), custom);
  const result = ensurePrePushHook(dir);
  assert.deepEqual(result, { action: "left-custom", was: "custom" });
  assert.equal(readFileSync(join(dir, "pre-push"), "utf8"), custom);
});
