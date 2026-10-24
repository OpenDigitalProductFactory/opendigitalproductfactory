// Unit tests for the diff-honesty detector and its guard (BI-FACB7C05).
//
// Every fixture is inline. This file must never read the repository: a guard
// that guards guards would otherwise become the thing it is guarding against —
// the lesson `check-guard-conformance-marks.mjs` records for its own detector.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  blankSpans,
  findDiffSwallows,
  scanSpans,
  swallowsDiffFailure,
} from "./lib/guard-diff-honesty-detect.mjs";
import { findDishonestGuards } from "./check-guard-diff-honesty.mjs";

/** The pre-fix shape, reduced to its essentials. */
const DISHONEST = `
import { execFileSync } from "node:child_process";
function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8" });
  } catch (error) {
    return error.stdout?.toString() ?? "";
  }
}
function changed(base) {
  return git("diff", "--name-only", \`\${base}...HEAD\`).split("\\n").filter(Boolean);
}
`;

/** The converted shape. */
const HONEST = `
import { exitUnresolvable, listChangedFiles } from "./lib/git-changed-files.mjs";
function changed(base) {
  const listed = listChangedFiles(base, { diffArgs: ["--diff-filter=AM"] });
  if (listed.status === "unresolvable") exitUnresolvable("my-guard", base, listed.detail);
  return listed.files;
}
`;

describe("findDiffSwallows", () => {
  it("detects a swallowing wrapper feeding a three-dot diff range", () => {
    const findings = findDiffSwallows(DISHONEST);
    assert.equal(findings.length, 1);
    assert.match(findings[0].snippet, /stdout/);
  });

  it("passes the converted shape", () => {
    assert.deepEqual(findDiffSwallows(HONEST), []);
  });

  it("does not fire on a guard that merely DESCRIBES the anti-pattern", () => {
    // Every converted guard now carries a comment like this. Reporting them
    // would make the guard unusable on the very tree it just cleaned.
    const source = `
      // BI-B6433DC6: the bare git() wrapper used to do
      //   catch (e) { return e.stdout?.toString() ?? ""; }
      // which read as "no files changed" for \`\${base}...HEAD\`.
      ${HONEST}
    `;
    assert.deepEqual(findDiffSwallows(source), []);
  });

  it("does not fire on sample code carried as a string literal", () => {
    const source = `
      const SAMPLE = "catch (e) { return e.stdout ?? \\"\\"; }";
      const RANGE = "git diff \${base}...HEAD";
      ${HONEST}
    `;
    assert.deepEqual(findDiffSwallows(source), []);
  });

  it("accepts a raw diff AFTER the base has been established", () => {
    // Several converted guards legitimately keep a local wrapper for follow-up
    // reads once exitUnresolvable has already proven the base.
    const source = DISHONEST + `
      import { exitUnresolvable } from "./lib/git-changed-files.mjs";
      if (listed.status === "unresolvable") exitUnresolvable("g", base, listed.detail);
    `;
    assert.deepEqual(findDiffSwallows(source), []);
  });

  it("ignores a three-dot range that is not a diff", () => {
    // pr-readiness.mjs counts ahead/behind with rev-list. That range fails the
    // same way, but an empty result is not a claim about which files changed.
    const source = `
      import { execFileSync } from "node:child_process";
      function git(args) {
        try { return execFileSync("git", args, { encoding: "utf8" }); }
        catch (error) { return error.stdout?.toString() ?? ""; }
      }
      const counts = git(["rev-list", "--left-right", "--count", \`\${upstream}...HEAD\`]);
    `;
    assert.deepEqual(findDiffSwallows(source), []);
  });

  it("honours a stated allow marker", () => {
    assert.deepEqual(findDiffSwallows(`// diff-honesty: allow fixture\n${DISHONEST}`), []);
  });

  it("survives a regex literal containing quotes and a backtick", () => {
    // The real trap: check-test-clock-bombs.mjs carries /["'\`]\\d{4}-…/.
    // A scanner that only knows strings desynchronises here and silently loses
    // every later construct — a false NEGATIVE, the worst outcome for a guard.
    const source = `
      const DATE = /["'\\\`]\\d{4}-(?:0[1-9]|1[0-2])/;
      ${DISHONEST}
    `;
    const findings = findDiffSwallows(source);
    assert.equal(findings.length, 1, "regex literal must not hide the swallow");
  });

  it("survives a division that is not a regex", () => {
    const source = `const ratio = total / count; const half = ratio / 2;\n${DISHONEST}`;
    assert.equal(findDiffSwallows(source).length, 1);
  });

  it("swallowsDiffFailure agrees with findDiffSwallows", () => {
    assert.equal(swallowsDiffFailure(DISHONEST), true);
    assert.equal(swallowsDiffFailure(HONEST), false);
  });
});

describe("scanSpans / blankSpans", () => {
  it("classifies a regex literal as regex, not string", () => {
    const kinds = scanSpans(`const r = /["']x/;`).map((s) => s.kind);
    assert.ok(kinds.includes("regex"), `expected a regex span, got ${kinds.join(",")}`);
  });

  it("preserves line count when blanking", () => {
    const source = `line1\n/* a\n b */\nline4\n`;
    assert.equal(blankSpans(source, ["comment"]).split("\n").length, source.split("\n").length);
  });

  it("keeps string delimiters so positions still line up", () => {
    const blanked = blankSpans(`const a = "secret";`, ["string"]);
    assert.equal(blanked.length, `const a = "secret";`.length);
    assert.ok(!blanked.includes("secret"));
    assert.ok(blanked.includes('"'));
  });
});

describe("findDishonestGuards", () => {
  it("reports the offending file and line, with sources injected", () => {
    const findings = findDishonestGuards({
      files: ["scripts/check-bad.mjs", "scripts/check-good.mjs"],
      readSource: (file) => (file === "scripts/check-bad.mjs" ? DISHONEST : HONEST),
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].file, "scripts/check-bad.mjs");
    assert.ok(findings[0].line > 0);
  });

  it("is empty when every guard is honest", () => {
    assert.deepEqual(
      findDishonestGuards({ files: ["scripts/a.mjs"], readSource: () => HONEST }),
      [],
    );
  });

  it("skips unreadable files rather than throwing", () => {
    assert.deepEqual(
      findDishonestGuards({ files: ["scripts/gone.mjs"], readSource: () => null }),
      [],
    );
  });
});
