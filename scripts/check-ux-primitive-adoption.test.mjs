// Self-test for the UX primitive-adoption ratchet (BI-D25ED55D).
// Covers the ratchet verdicts per budget: NEW file fails, growth in a known
// file fails, a baselined count passes, and a shrink passes (reporting stale
// entries for --update) — plus the pattern matchers and baseline contract.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ACCENT_BUTTON_RE,
  CARD_STRING_RE,
  TEXT_WHITE_RE,
  checkBoundaryCoverage,
  computeBudgets,
  countMatches,
  evaluateBudget,
  runCheck,
  validateBaseline,
} from "./check-ux-primitive-adoption.mjs";

const CARD_DIV =
  '<div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">';
const CARD_DIV_REVERSED =
  '<div className="bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] p-4">';
const ACCENT_BUTTON =
  '<button className="rounded-md bg-[var(--dpf-accent)] px-4 py-2 text-white">Go</button>';

function baseline(overrides = {}) {
  return {
    version: 1,
    owner: "platform-architecture",
    expiry: "2099-01-01",
    accentButton: {},
    cardString: {},
    textWhite: {},
    ...overrides,
  };
}

test("pattern matchers count accent buttons, both card orders, and text-white", () => {
  assert.equal(countMatches(ACCENT_BUTTON, ACCENT_BUTTON_RE), 1);
  assert.equal(countMatches(ACCENT_BUTTON, TEXT_WHITE_RE), 1);
  assert.equal(countMatches(CARD_DIV, CARD_STRING_RE), 1);
  assert.equal(countMatches(CARD_DIV_REVERSED, CARD_STRING_RE), 1);
  // The border and surface tokens in SEPARATE strings are not one card string.
  const separate = 'a("border-[var(--dpf-border)]"); b("bg-[var(--dpf-surface-1)]")';
  assert.equal(countMatches(separate, CARD_STRING_RE), 0);
  // A state-variant utility is not a card: a secondary button hovering onto
  // surface-1 must not count.
  const hoverOnly =
    '"border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] hover:bg-[var(--dpf-surface-1)]"';
  assert.equal(countMatches(hoverOnly, CARD_STRING_RE), 0);
  // text-whitespace must not match \btext-white\b's word boundary loosely.
  assert.equal(countMatches("text-white/80 text-whitesmoke", TEXT_WHITE_RE), 1);
});

test("components/ui is the canonical home: exempt from accent/card budgets, NOT from text-white", () => {
  const budgets = computeBudgets([
    { path: "apps/web/components/ui/Button.tsx", source: ACCENT_BUTTON + CARD_DIV },
  ]);
  assert.deepEqual(budgets.accentButton, {});
  assert.deepEqual(budgets.cardString, {});
  assert.deepEqual(budgets.textWhite, { "apps/web/components/ui/Button.tsx": 1 });
});

test("a NEW file beyond the baseline fails; growth in a known file fails", () => {
  const files = [{ path: "apps/web/app/x/page.tsx", source: ACCENT_BUTTON + ACCENT_BUTTON }];
  const fresh = runCheck({ files, baseline: baseline(), today: "2026-08-16" });
  assert.equal(fresh.ok, false);
  assert.match(fresh.evaluation.accentButton.growth[0], /new, 2/);

  const grown = runCheck({
    files,
    baseline: baseline({
      accentButton: { "apps/web/app/x/page.tsx": 1 },
      textWhite: { "apps/web/app/x/page.tsx": 2 },
    }),
    today: "2026-08-16",
  });
  assert.equal(grown.ok, false);
  assert.match(grown.evaluation.accentButton.growth[0], /1 -> 2/);
});

test("a baselined count passes; a shrink passes and reports stale budgets", () => {
  const files = [{ path: "apps/web/app/x/page.tsx", source: ACCENT_BUTTON }];
  const held = runCheck({
    files,
    baseline: baseline({
      accentButton: { "apps/web/app/x/page.tsx": 1 },
      textWhite: { "apps/web/app/x/page.tsx": 1 },
    }),
    today: "2026-08-16",
  });
  assert.equal(held.ok, true);
  assert.deepEqual(held.evaluation.accentButton.stale, []);

  const shrunk = runCheck({
    files,
    baseline: baseline({
      accentButton: { "apps/web/app/x/page.tsx": 3, "apps/web/app/gone.tsx": 2 },
      textWhite: { "apps/web/app/x/page.tsx": 1 },
    }),
    today: "2026-08-16",
  });
  assert.equal(shrunk.ok, true);
  assert.deepEqual(shrunk.evaluation.accentButton.stale, [
    "apps/web/app/gone.tsx (2 -> 0)",
    "apps/web/app/x/page.tsx (3 -> 1)",
  ]);
});

test("evaluateBudget is exact about growth vs stale", () => {
  const { growth, stale } = evaluateBudget({ a: 2, b: 1 }, { a: 1, c: 4 });
  assert.deepEqual(growth, ["a (1 -> 2)", "b (new, 1)"]);
  assert.deepEqual(stale, ["c (4 -> 0)"]);
});

test("boundary coverage: page-rendering groups need error.tsx + loading.tsx; api and handler-only segments exempt", () => {
  // Synthetic app dir: (shell) has pages + both boundaries; (new) has a page
  // and no boundaries; api and hooks-only segments are skipped.
  const dirent = (name, isDir) => ({ name, isFile: () => !isDir, isDirectory: () => isDir });
  const tree = {
    "/app": [dirent("(shell)", true), dirent("(new)", true), dirent("api", true), dirent("connect", true)],
    "/app/(shell)": [dirent("page.tsx", false), dirent("error.tsx", false), dirent("loading.tsx", false)],
    "/app/(new)": [dirent("sub", true)],
    "/app/(new)/sub": [dirent("page.tsx", false)],
    "/app/api": [dirent("route.ts", false)],
    "/app/connect": [dirent("route.ts", false)],
  };
  const existing = new Set(["/app/(shell)/error.tsx", "/app/(shell)/loading.tsx"]);
  const { groups, missing } = checkBoundaryCoverage({
    appDir: "/app",
    readdir: (dir) => tree[dir.split("\\").join("/")] ?? [],
    exists: (p) => existing.has(p.split("\\").join("/")),
  });
  assert.deepEqual(groups, ["(new)", "(shell)"]);
  assert.deepEqual(missing, [
    "apps/web/app/(new)/error.tsx",
    "apps/web/app/(new)/loading.tsx",
  ]);

  // A missing boundary fails runCheck even with clean budgets.
  const result = runCheck({
    files: [],
    baseline: baseline(),
    today: "2026-08-16",
    boundary: { groups: ["(new)"], missing: ["apps/web/app/(new)/error.tsx"] },
  });
  assert.equal(result.ok, false);
});

test("baseline contract: version, owner, expiry (expired fails), map shapes", () => {
  assert.deepEqual(validateBaseline(baseline(), { today: "2026-08-16" }), []);
  const expired = validateBaseline(baseline({ expiry: "2026-01-01" }), { today: "2026-08-16" });
  assert.match(expired[0], /expired/);
  const malformed = validateBaseline(baseline({ cardString: [] }), { today: "2026-08-16" });
  assert.match(malformed[0], /cardString/);
  const noOwner = validateBaseline(baseline({ owner: " " }), { today: "2026-08-16" });
  assert.match(noOwner[0], /owner/);
});
