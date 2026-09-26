import { test } from "node:test";
import assert from "node:assert/strict";

import { countCategories, diff, parseBaseline, stripComments, totalsByCategory } from "./check-no-unlocalized-ui.mjs";

const tsx = (source) => countCategories(source, { isTsx: true });

test("physical-direction counts Tailwind physical classes, with variants and negatives", () => {
  const source = `<div className="ml-2 md:pr-4 -left-1 text-right border-l rounded-r-lg hover:mr-auto" />`;
  assert.equal(tsx(source)["physical-direction"], 7);
});

test("physical-direction ignores logical classes and look-alike words", () => {
  const source = `<div className="ms-2 pe-4 start-0 text-start border-s rounded-e summer-sale hammer-time" />`;
  assert.equal(tsx(source)["physical-direction"], 0);
});

test("physical-direction counts inline physical styles", () => {
  const source = `const s = { marginLeft: 4, paddingRight: 2, textAlign: "right", left: 0, borderLeftColor: "x" };`;
  assert.equal(countCategories(source, { isTsx: false })["physical-direction"], 5);
});

test("classes named in comments are not counted", () => {
  const source = `// use text-right here\n/* ml-2 was removed */\nconst a = 1;`;
  assert.equal(tsx(source)["physical-direction"], 0);
  assert.equal(stripComments(`const url = "https://x.test/ml-2";`).includes("https://x.test/ml-2"), true);
});

test("locale-literal counts hardcoded en-GB / en-US and literal toLocale locales", () => {
  const source = `a.toLocaleString("en-GB"); b.toLocaleDateString('en-US'); c.toLocaleString("de-DE"); d.toLocaleString(locale);`;
  assert.equal(countCategories(source, { isTsx: false })["locale-literal"], 3);
});

test("money-prefix counts $-prefixed templates, not regex dollars", () => {
  const source = "const a = `$${amount}`; const re = /^\\$\\d+$/; const b = <span>$</span>;";
  assert.equal(countCategories(source, { isTsx: false })["money-prefix"], 2);
});

test("money-prefix ignores SQL placeholders and spreadsheet absolute references", () => {
  const source = "a = `$${params.length}::jsonb`; b = `$${paramIdx}`; c = `$${columnLetter(i)}2`; d = `up to $${ceilingUsd}`;";
  assert.equal(countCategories(source, { isTsx: false })["money-prefix"], 1);
});

test("jsx-copy counts bare multi-word JSX text and capitalized UI attributes, in .tsx only", () => {
  const source = `<p>Nothing needs attention.</p><input placeholder="Search accounts" aria-label="Close dialog" /><b>{count}</b><i>OK</i>`;
  assert.equal(tsx(source)["jsx-copy"], 3);
  assert.equal(countCategories(source, { isTsx: false })["jsx-copy"], 0);
});

test("parseBaseline reads the 3-column format, skips the budget header, and resolves duplicates to the min", () => {
  const text = [
    "# owner: platform-architecture",
    "# expiry: 2027-03-31",
    "apps/web/a.tsx\tjsx-copy\t4",
    "apps/web/a.tsx\tjsx-copy\t3",
    "apps/web/b.ts\tlocale-literal\t2",
    "garbage line",
    "apps/web/c.ts\tnot-a-category\t9",
  ].join("\n");
  assert.deepEqual(parseBaseline(text), {
    "apps/web/a.tsx\tjsx-copy": 3,
    "apps/web/b.ts\tlocale-literal": 2,
  });
});

test("diff fails a new file and a grown count, and accepts a shrink", () => {
  const baseline = { "a.tsx\tjsx-copy": 3, "b.ts\tlocale-literal": 2 };
  const current = { "a.tsx\tjsx-copy": 4, "b.ts\tlocale-literal": 1, "c.tsx\tphysical-direction": 1 };
  const { grew, fresh } = diff(current, baseline);
  assert.deepEqual(grew, ["a.tsx [jsx-copy] 3 -> 4"]);
  assert.deepEqual(fresh, ["c.tsx [physical-direction] 1"]);
  assert.deepEqual(diff({ "a.tsx\tjsx-copy": 2 }, baseline), { grew: [], fresh: [] });
});

test("totalsByCategory sums per category", () => {
  assert.deepEqual(totalsByCategory({ "a\tjsx-copy": 2, "b\tjsx-copy": 1, "c\tmoney-prefix": 4 }), {
    "jsx-copy": 3,
    "locale-literal": 0,
    "physical-direction": 0,
    "money-prefix": 4,
  });
});
