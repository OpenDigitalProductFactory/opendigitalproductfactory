// Tests for the single-reader X-Forwarded-For guard (BI-1FF67B91).
// Run: node --test scripts/check-xff-single-reader.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CANONICAL, findXffReads, scanRepo } from "./check-xff-single-reader.mjs";

test("flags each way a route can read the header", () => {
  assert.equal(findXffReads('const ip = req.headers.get("x-forwarded-for")?.split(",")[0];').length, 1);
  assert.equal(findXffReads("const ip = request.headers.get('X-Forwarded-For');").length, 1);
  assert.equal(findXffReads('const raw = headers["x-forwarded-for"];').length, 1);
  assert.equal(findXffReads("const h = `x-forwarded-for`;").length, 1);
});

test("ignores comments", () => {
  assert.equal(findXffReads("// never read x-forwarded-for directly").length, 0);
  assert.equal(findXffReads(" * X-Forwarded-For is appended to by each proxy").length, 0);
});

// AC-1: a fixture route that reads the header directly fails the guard.
test("a route outside client-address.ts that reads the header is a violation; the canonical home is not", () => {
  const root = mkdtempSync(join(tmpdir(), "xff-guard-"));
  try {
    const route = join(root, "apps", "web", "app", "api", "thing");
    mkdirSync(route, { recursive: true });
    writeFileSync(join(route, "route.ts"), 'export const key = (r) => r.headers.get("x-forwarded-for")?.split(",")[0];\n');
    const home = join(root, ...CANONICAL.split("/"));
    mkdirSync(join(home, ".."), { recursive: true });
    writeFileSync(home, 'export const read = (h) => h.get("x-forwarded-for");\n');
    writeFileSync(join(route, "route.test.ts"), 'headers: { "x-forwarded-for": "1.2.3.4" }\n');

    const violations = scanRepo(root);
    assert.deepEqual(violations.map((v) => v.file), ["apps/web/app/api/thing/route.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// AC-1: and passes on the real tree.
test("repo: only client-address.ts reads X-Forwarded-For", () => {
  assert.deepEqual(scanRepo(), []);
});
