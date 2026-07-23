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

// ─── Token drift: spacing / type / motion (BI-CBC7430F, EP-UX-SYSTEM L4) ─────

import { tokenDriftMatches } from "./check-style-drift.mjs";

test("arbitrary font sizes are off-scale — the type scale carries line-heights", () => {
  assert.equal(tokenDriftMatches('className="text-[13px]"').type, 1);
  assert.equal(tokenDriftMatches('className="text-[0.8rem]"').type, 1);
  // The sub-legible sizes the live UX audit flagged.
  assert.equal(tokenDriftMatches('className="text-[9px] text-[10px]"').type, 2);
});

test("token type utilities and colour arbitraries are NOT type drift", () => {
  assert.equal(tokenDriftMatches('className="text-dpf-body"').type, 0);
  assert.equal(tokenDriftMatches('className="text-sm"').type, 0);
  // Colour has its own ratchet; text-[var(--dpf-text)] is the legal spelling.
  assert.equal(tokenDriftMatches('className="text-[var(--dpf-text)]"').type, 0);
  assert.equal(tokenDriftMatches('className="text-[#0a0a0a]"').type, 0);
});

test("spacing is judged against the 4-pt grid, not against a name list", () => {
  assert.equal(tokenDriftMatches('className="p-[7px]"').spacing, 1);
  assert.equal(tokenDriftMatches('className="gap-[2px]"').spacing, 1);
  // On-grid arbitrary values stay legal — the scale IS 4-pt.
  assert.equal(tokenDriftMatches('className="p-[8px] gap-[16px] mt-[24px]"').spacing, 0);
});

test("spacing matching does not misfire on other utilities ending in a prefix", () => {
  // "gap-[2px]" must not also count as a `p-[...]` match, and top-/drop- must not match.
  assert.equal(tokenDriftMatches('className="gap-[2px]"').spacing, 1);
  assert.equal(tokenDriftMatches('className="top-[3px]"').spacing, 0);
});

test("motion drift is an off-token duration or an inline keyframe", () => {
  assert.equal(tokenDriftMatches('className="duration-[250ms]"').motion, 1);
  assert.equal(tokenDriftMatches('className="animate-[wiggle_1s]"').motion, 1);
  // The tokenised durations (--dpf-duration-fast/base/slow).
  assert.equal(tokenDriftMatches('className="duration-[150ms] duration-[200ms] duration-[320ms]"').motion, 0);
  assert.equal(tokenDriftMatches('className="animate-dpf-fade-in ease-dpf-out"').motion, 0);
});

test("a clean line reports zero on every axis", () => {
  const m = tokenDriftMatches('className="flex items-center gap-dpf-md text-dpf-body"');
  assert.deepEqual(m, { type: 0, spacing: 0, motion: 0 });
});
