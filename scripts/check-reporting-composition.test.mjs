/**
 * EP-829D997C / BI-801758D1 — tests for the reporting-composition guard's raw
 * `<table>` matcher.
 *
 * The guard ratchets adoption of the report-kit DataTable by failing PRs that add
 * NEW raw `<table>` markup. rawTableMatches() is the pure line-level detector: it
 * counts JSX `<table>` opening tags, honors the `reporting-composition-allow`
 * opt-out, and must not confuse a component named `<TableFoo>` for a raw table.
 *
 * Run: node --test scripts/check-reporting-composition.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { rawTableMatches } from "./check-reporting-composition.mjs";

test("a raw <table> opening tag is caught", () => {
  assert.equal(rawTableMatches('<table className="w-full">').length, 1);
  assert.equal(rawTableMatches("<table>").length, 1);
  assert.equal(rawTableMatches("return <table />;").length, 1);
});

test("pretty-printed multiline <table at end of line is caught (BI-F7792FC1)", () => {
  // Attributes on the next line used to evade the ratchet because the line ended
  // immediately after `<table` with no whitespace/`>`/`/` on that same line.
  assert.equal(rawTableMatches("          <table").length, 1);
  assert.equal(rawTableMatches("<table").length, 1);
});

test("a capitalized component like <TableRoot> is NOT a raw table", () => {
  // TABLE_RE requires whitespace/`>`/`/` right after `table`; `<TableRoot` and
  // `<Table` (a component) both start with a capital and never match `<table`.
  assert.deepEqual(rawTableMatches("<TableRoot>"), []);
  assert.deepEqual(rawTableMatches("<Table>"), []);
  assert.deepEqual(rawTableMatches("<DataTable rows={rows} />"), []);
});

test("a substring like <tablet> is not a raw <table>", () => {
  // `<tablet` -> after `table` comes `t`, which is not whitespace/`>`/`/`.
  assert.deepEqual(rawTableMatches("<tablet-frame>"), []);
});

test("the allow-comment opts a line out entirely", () => {
  assert.deepEqual(
    rawTableMatches("<table> // reporting-composition-allow: email HTML"),
    [],
  );
});

test("two raw tables on one line count as two", () => {
  assert.equal(rawTableMatches("<table></table><table>").length, 2);
});
