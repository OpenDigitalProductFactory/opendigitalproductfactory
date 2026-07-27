import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("web vitest coverage config includes unloaded owned files (all: true)", () => {
  const src = readFileSync(join(root, "apps/web/vitest.config.ts"), "utf8");
  assert.match(src, /coverage\s*:\s*\{/);
  assert.match(src, /provider:\s*["']v8["']/);
  assert.match(src, /all:\s*true/);
  assert.match(src, /include:\s*\[/);
  assert.match(src, /lib\/\*\*\/\*\.\{ts,tsx\}/);
});

test("db vitest coverage config includes unloaded owned files (all: true)", () => {
  const src = readFileSync(join(root, "packages/db/vitest.config.ts"), "utf8");
  assert.match(src, /coverage\s*:\s*\{/);
  assert.match(src, /provider:\s*["']v8["']/);
  assert.match(src, /all:\s*true/);
  // Plan contract (BI-2F60FDCE): owned db sources are .ts (no .tsx in packages/db).
  assert.match(src, /src\/\*\*\/\*\.ts/);
});
