// scripts/build-docs-staleness.test.mjs
//
// Exercises the detector against a synthetic git repo with controlled commit dates:
// a doc whose referenced file was committed LATER is flagged; a doc + target
// committed together is not; the --check flag detects an out-of-date report.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "build-docs-staleness.mjs");
const REPORT_REL = "docs/maintenance/staleness-report.md";

function gitRepo() {
  const root = mkdtempSync(join(tmpdir(), "docstale-"));
  const git = (args, dateIso) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: dateIso ?? "",
        GIT_COMMITTER_DATE: dateIso ?? "",
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t.t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t.t",
      },
    });
  git(["init", "-q"]);
  const write = (rel, body) => {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  const commit = (dateIso) => {
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "c", "--allow-empty"], dateIso);
  };
  const run = (args = []) => execFileSync("node", [SCRIPT, ...args], { cwd: root, encoding: "utf8", env: { ...process.env, DOC_STALE_ROOT: root } });
  const report = () => readFileSync(join(root, REPORT_REL), "utf8");
  return { root, write, commit, run, report, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("flags a doc whose referenced file was committed later", () => {
  const r = gitRepo();
  try {
    r.write("docs/guide.md", "See [code](../src/x.ts) for details.");
    r.write("src/x.ts", "v1");
    r.commit("2026-01-01T00:00:00");
    r.write("src/x.ts", "v2 — behaviour changed");
    r.commit("2026-02-01T00:00:00");
    r.run();
    const report = r.report();
    assert.match(report, /docs\/guide\.md/);
    assert.match(report, /src\/x\.ts/);
    assert.match(report, /stale-candidate/);
  } finally {
    r.cleanup();
  }
});

test("does NOT flag a doc committed together with its target", () => {
  const r = gitRepo();
  try {
    r.write("docs/guide.md", "See [code](../src/x.ts).");
    r.write("src/x.ts", "v1");
    r.commit("2026-01-01T00:00:00"); // same commit ⇒ same ts ⇒ not stale
    r.run();
    assert.match(r.report(), /\*\*0\*\* stale-candidate/);
  } finally {
    r.cleanup();
  }
});

test("does not police docs/superpowers/ as a source", () => {
  const r = gitRepo();
  try {
    r.write("docs/superpowers/plans/p.md", "See [code](../../../src/x.ts).");
    r.write("src/x.ts", "v1");
    r.commit("2026-01-01T00:00:00");
    r.write("src/x.ts", "v2");
    r.commit("2026-02-01T00:00:00");
    r.run();
    assert.match(r.report(), /\*\*0\*\* stale-candidate/);
  } finally {
    r.cleanup();
  }
});

test("ignores external links and route paths (no file to compare)", () => {
  const r = gitRepo();
  try {
    r.write("docs/guide.md", "[site](https://x.com) and [route](/portal/cases).");
    r.commit("2026-01-01T00:00:00");
    r.write("docs/other.md", "later");
    r.commit("2026-02-01T00:00:00");
    r.run();
    assert.match(r.report(), /\*\*0\*\* stale-candidate/);
  } finally {
    r.cleanup();
  }
});

test("--check fails when the committed report is out of date", () => {
  const r = gitRepo();
  try {
    r.write("docs/guide.md", "See [code](../src/x.ts).");
    r.write("src/x.ts", "v1");
    r.commit("2026-01-01T00:00:00");
    r.write("src/x.ts", "v2");
    r.commit("2026-02-01T00:00:00");
    r.write(REPORT_REL, "# stale — but wrong/empty\n"); // deliberately out of date
    let code = 0;
    try {
      r.run(["--check"]);
    } catch (e) {
      code = e.status ?? 1;
    }
    assert.equal(code, 1);
  } finally {
    r.cleanup();
  }
});
