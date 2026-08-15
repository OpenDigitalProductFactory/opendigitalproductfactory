// Self-test for the private-identity ratchet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildTokenRegex, scan, parseBaseline, diff, scanStaged } from "./check-no-private-identity.mjs";

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

// ─── Staged (pre-commit) tripwire — BI-C9E5E7D9 ──────────────────────────────

test("scanStaged counts tokens per staged file and records the matched tokens", () => {
  const re = buildTokenRegex(TOKENS);
  const { counts, tokensByFile } = scanStaged(re, {
    files: ["docs/spec.md", "apps/web/lib/x.ts"],
    readBlob: (rel) =>
      rel === "docs/spec.md" ? "AcmeCorp ships. acmecorp again." : "no token here",
  });
  assert.deepEqual(counts, { "docs/spec.md": 2 });
  assert.deepEqual(tokensByFile["docs/spec.md"], ["acmecorp"]);
});

test("scanStaged honors SCAN_EXT / SCAN_DIRS / SELF_EXCLUDE like the CI scan", () => {
  const re = buildTokenRegex(TOKENS);
  const { counts } = scanStaged(re, {
    files: [
      "README.md",                                   // outside SCAN_DIRS → ignored
      "docs/logo.png",                               // non-scannable ext → ignored
      "scripts/private-identity-tokens.txt",         // self-exclude → ignored
      "packages/db/notes.md",                        // scanned
    ],
    readBlob: () => "AcmeCorp",
  });
  assert.deepEqual(counts, { "packages/db/notes.md": 1 });
});

test("staged diff blocks a NEW file but allows a legitimately-baselined occurrence", () => {
  const re = buildTokenRegex(TOKENS);
  const { counts } = scanStaged(re, {
    files: ["docs/new-leak.md", "docs/baselined.md"],
    readBlob: () => "AcmeCorp",
  });
  const baseline = { "docs/baselined.md": 1 };
  const { grew, fresh } = diff(counts, baseline);
  assert.deepEqual(fresh, ["docs/new-leak.md (1)"]); // new file → blocked
  assert.equal(grew.length, 0);                      // baselined occurrence → allowed
});

test("staged diff flags a grown count in an already-baselined file", () => {
  const re = buildTokenRegex(TOKENS);
  const { counts } = scanStaged(re, {
    files: ["docs/baselined.md"],
    readBlob: () => "AcmeCorp and AcmeCorp",
  });
  const { grew, fresh } = diff(counts, { "docs/baselined.md": 1 });
  assert.deepEqual(grew, ["docs/baselined.md (1 -> 2)"]);
  assert.equal(fresh.length, 0);
});
