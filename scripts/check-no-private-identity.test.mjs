// Self-test for the private-identity ratchet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildTokenRegex, scan, parseBaseline, diff } from "./check-no-private-identity.mjs";

// A fixture token that is NOT a real protected name, so the test never depends
// on the live denylist.
const TOKENS = "# comment line\n\nAcmeCorp\n";

test("buildTokenRegex matches the token case-insensitively on word boundaries", () => {
  const re = buildTokenRegex(TOKENS);
  assert.equal((`We are ACMECORP LLC`.match(re) ?? []).length, 1);
  assert.equal((`acmecorp and AcmeCorp again`.match(re) ?? []).length, 2);
});

test("buildTokenRegex does not match a substring inside another word", () => {
  const re = buildTokenRegex(TOKENS);
  assert.equal((`AcmeCorporation`.match(re) ?? []).length, 0);
});

test("buildTokenRegex returns null for an empty/comments-only denylist", () => {
  assert.equal(buildTokenRegex("# only comments\n\n"), null);
});

test("scan counts token occurrences per file and skips excluded dirs/exts", () => {
  const root = mkdtempSync(join(tmpdir(), "idguard-"));
  try {
    mkdirSync(join(root, "docs"), { recursive: true });
    mkdirSync(join(root, "docs", "node_modules"), { recursive: true });
    writeFileSync(join(root, "docs", "leak.md"), "AcmeCorp did a thing. AcmeCorp again.");
    writeFileSync(join(root, "docs", "clean.md"), "nothing to see here");
    writeFileSync(join(root, "docs", "asset.png"), "AcmeCorp"); // wrong ext → skipped
    writeFileSync(join(root, "docs", "node_modules", "vendor.md"), "AcmeCorp"); // skip dir
    const counts = scan(buildTokenRegex(TOKENS), { repoRoot: root, scanDirs: ["docs"] });
    assert.equal(counts["docs/leak.md"], 2);
    assert.equal(counts["docs/clean.md"], undefined);
    assert.equal(counts["docs/asset.png"], undefined);
    assert.equal(counts["docs/node_modules/vendor.md"], undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parseBaseline resolves union-merge duplicate paths to the max count", () => {
  const parsed = parseBaseline("a/x.md\t3\nb/y.md\t1\na/x.md\t5\n");
  assert.equal(parsed["a/x.md"], 5);
  assert.equal(parsed["b/y.md"], 1);
});

test("diff flags a new file and a grown file, ignores a shrunk file", () => {
  const baseline = { "a.md": 2, "b.md": 4 };
  const current = { "a.md": 3, "b.md": 1, "c.md": 1 };
  const { grew, fresh } = diff(current, baseline);
  assert.deepEqual(fresh, ["c.md (1)"]);
  assert.deepEqual(grew, ["a.md (2 -> 3)"]);
});

test("diff is clean when everything is at or below baseline", () => {
  const { grew, fresh } = diff({ "a.md": 1 }, { "a.md": 2 });
  assert.equal(grew.length, 0);
  assert.equal(fresh.length, 0);
});
