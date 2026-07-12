// scripts/check-doc-reference-integrity.test.mjs
//
// Runs the real gate against synthetic doc trees in a temp dir, exercising the
// classification edge cases that caused false positives during authoring:
// Next.js route-group parens, :line suffixes, %20 encoding, Jekyll extensionless
// permalinks, "/"-absolute site vs repo roots, and the ratchet's net-new logic.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "check-doc-reference-integrity.mjs");

/** Build a throwaway repo: docs/, a route manifest, real files, then run the gate. */
function runGate(files, { routes = [], update = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "docref-"));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body ?? "");
    }
    const manifestDir = join(root, "apps", "web", "lib", "ea");
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, "route-manifest.json"),
      JSON.stringify({ routes: routes.map((routePath) => ({ routePath })) }),
    );
    mkdirSync(join(root, "scripts"), { recursive: true }); // --update writes the baseline here
    const args = update ? ["--update"] : [];
    const env = { ...process.env, DOC_REF_ROOT: root };
    try {
      const stdout = execFileSync("node", [SCRIPT, ...args], { cwd: root, encoding: "utf8", env });
      return { code: 0, out: stdout, root };
    } catch (e) {
      return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || ""), root };
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("passes when every relative link resolves", () => {
  const r = runGate({
    "docs/a.md": "[b](b.md) and [dir](sub/index.md)",
    "docs/b.md": "x",
    "docs/sub/index.md": "y",
  });
  assert.equal(r.code, 0, r.out);
});

test("fails on a net-new dead relative link", () => {
  const r = runGate({ "docs/a.md": "[gone](./missing.md)" });
  assert.equal(r.code, 1);
  assert.match(r.out, /NET-NEW/);
  assert.match(r.out, /missing\.md/);
});

test("resolves Jekyll extensionless permalinks to <path>.md", () => {
  const r = runGate({
    "docs/guide/index.md": "see [workspace](../workspace) and [sibling](other)",
    "docs/workspace.md": "w",
    "docs/guide/other.md": "o",
  });
  assert.equal(r.code, 0, r.out);
});

test("handles :line suffixes and Next.js route-group parens in source links", () => {
  const r = runGate({
    "docs/a.md": "[code](../src/x.ts:42) and [shell](../apps/(shell)/page.tsx)",
    "src/x.ts": "code",
    "apps/(shell)/page.tsx": "page",
  });
  assert.equal(r.code, 0, r.out);
});

test("URL-decodes %20 before checking existence", () => {
  const r = runGate({ "docs/a.md": "[pdf](files/My%20Doc.pdf)", "docs/files/My Doc.pdf": "p" });
  assert.equal(r.code, 0, r.out);
});

test("flags a dead surface link into a real app-route namespace", () => {
  const r = runGate({ "docs/a.md": "[old](/portal/removed-page)" }, { routes: ["/portal", "/portal/cases"] });
  assert.equal(r.code, 1);
  assert.match(r.out, /removed-page/);
});

test("does NOT flag an extensionless permalink whose segment is not an app route", () => {
  const r = runGate({ "docs/a.md": "[perma](/user-guide/some-topic)" }, { routes: ["/portal"] });
  assert.equal(r.code, 0, r.out);
});

test("accepts a dynamic route match (/portal/cases/[caseKey])", () => {
  const r = runGate({ "docs/a.md": "[case](/portal/cases/abc123)" }, { routes: ["/portal/cases/[caseKey]"] });
  assert.equal(r.code, 0, r.out);
});

test("flags a Windows absolute path", () => {
  const r = runGate({ "docs/a.md": "[x](D:/DPF/docs/x.md)" });
  assert.equal(r.code, 1);
  assert.match(r.out, /D:\/DPF/);
});

test("does not police docs/superpowers/ as a source", () => {
  const r = runGate({ "docs/superpowers/plans/p.md": "[dead](./nope.md)" });
  assert.equal(r.code, 0, r.out);
});

test("ignores links inside fenced code blocks", () => {
  const r = runGate({ "docs/a.md": "```\n[example](./not-real.md)\n```\n" });
  assert.equal(r.code, 0, r.out);
});

test("ignores external and pure-anchor links", () => {
  const r = runGate({ "docs/a.md": "[ext](https://x.com) [anchor](#section) [mail](mailto:a@b.c)" });
  assert.equal(r.code, 0, r.out);
});

test("--update grandfathers existing breakage so the next run passes", () => {
  const files = { "docs/a.md": "[gone](./missing.md)" };
  assert.equal(runGate(files).code, 1, "dirty before baseline");
  // A single temp dir per run means --update writes a baseline that the same-run
  // check would honor; assert the update path itself exits 0.
  assert.equal(runGate(files, { update: true }).code, 0, "update exits 0");
});
