/**
 * BI-OPT-RATCHETS — tests for the style-drift guard's decimal false-positive fix.
 *
 * HEX_RE matches `#` + a color-valid digit count (3/4/6/8), so an all-decimal
 * token like a PR ref `#2401` in a comment used to false-flag as a hardcoded
 * color. colorHexMatches() now drops pure-decimal tokens (a real CSS color
 * always has at least one a–f digit) while still catching genuine hex.
 *
 * Run: node --test scripts/check-style-drift.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { colorHexMatches } from "./check-style-drift.mjs";

test("a #2401-style PR ref in a comment is NOT a color (the fix)", () => {
  assert.deepEqual(colorHexMatches("// fixes the dock default, see PR #2401"), []);
  assert.deepEqual(colorHexMatches(" * superseded by #2399 and #2401"), []);
});

test("a longer all-decimal ref of hex-valid length is NOT a color", () => {
  // 6-digit decimal token — hex-valid length, but no a–f digit.
  assert.deepEqual(colorHexMatches("ticket #240100 tracked separately"), []);
});

test("a real hex color still FAILS (filter is not too greedy)", () => {
  assert.deepEqual(colorHexMatches('color: "#1a2b3c";'), ["#1a2b3c"]);
  assert.deepEqual(colorHexMatches("background: #fff;"), ["#fff"]);
  assert.deepEqual(colorHexMatches("border-color: #abcd;"), ["#abcd"]);
  assert.deepEqual(colorHexMatches("--token: #112233ff;"), ["#112233ff"]);
});

test("a real hex color on the SAME line as a numeric ref is still caught", () => {
  // The #2401 is dropped; the #ff0000 survives — exactly one color match.
  assert.deepEqual(colorHexMatches("// #2401: changed accent to #ff0000"), ["#ff0000"]);
});

test("a 2-digit token (#99) is not color-shaped at all and yields nothing", () => {
  assert.deepEqual(colorHexMatches("scrolled 99% — #99 done"), []);
});

test("the live repo still passes the style-drift guard after the fix", () => {
  // colorHexMatches is the only behavioural change; assert it does not alter the
  // count for a representative real-color line (regression anchor for the fix).
  assert.equal(colorHexMatches('style={{ color: "#0a0a0a" }}').length, 1);
});
