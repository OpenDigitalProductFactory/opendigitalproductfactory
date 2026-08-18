// Self-test for the one-ActionResult ratchet (BI-1CED89B9).
import test from "node:test";
import assert from "node:assert/strict";

import {
  CANONICAL_MODULE,
  countInlineOkTrue,
  findLocalAliases,
  runCheck,
  validateBaseline,
} from "./check-no-local-action-result.mjs";

const ALIAS_TYPE = 'type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };';
const ALIAS_INTERFACE = "export interface ActionResult { ok: boolean }";
const ALIAS_RESULT_OK = "type Result<T = void> =\n  | (T extends void ? { ok: true } : { ok: true } & T)\n  | { ok: false; error: string };";
const DOMAIN_RESULT = "export type MergeResult = { movedRows: number };";
const DOMAIN_OK_CONTRACT =
  "export type EnvelopeActionResult<T> = { ok: true; envelope: T } | { ok: false; reason: string };";
const NON_OK_RESULT = 'type Result = "pass" | "fail";';

function baseline(overrides = {}) {
  return {
    version: 1,
    owner: "platform-architecture",
    expiry: "2099-01-01",
    localAliases: [],
    inlineOkTrueTotal: 10,
    ...overrides,
  };
}

test("alias detection: generic names flagged, domain names and non-ok Results ignored", () => {
  const files = [
    { path: "apps/web/lib/a.ts", source: ALIAS_TYPE },
    { path: "apps/web/lib/b.ts", source: ALIAS_INTERFACE },
    { path: "apps/web/lib/c.ts", source: ALIAS_RESULT_OK },
    { path: "apps/web/lib/d.ts", source: DOMAIN_RESULT },
    { path: "apps/web/lib/e.ts", source: DOMAIN_OK_CONTRACT },
    { path: "apps/web/lib/f.ts", source: NON_OK_RESULT },
  ];
  assert.deepEqual(findLocalAliases(files), [
    "apps/web/lib/a.ts",
    "apps/web/lib/b.ts",
    "apps/web/lib/c.ts",
  ]);
});

test("the canonical module itself is never a violation and never counted", () => {
  const files = [
    { path: CANONICAL_MODULE, source: "export type ActionResult<T> = …; return { ok: true };" },
  ];
  assert.deepEqual(findLocalAliases(files), []);
  assert.equal(countInlineOkTrue(files), 0);
});

test("a NEW alias fails; zero aliases with held inline total passes", () => {
  const bad = runCheck({
    files: [{ path: "apps/web/lib/x.ts", source: ALIAS_TYPE }],
    baseline: baseline({ inlineOkTrueTotal: 1 }),
    today: "2026-08-16",
  });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.newAliases, ["apps/web/lib/x.ts"]);

  const good = runCheck({
    files: [{ path: "apps/web/lib/x.ts", source: "return ok();" }],
    baseline: baseline({ inlineOkTrueTotal: 0 }),
    today: "2026-08-16",
  });
  assert.equal(good.ok, true);
});

test("inline ok:true growth beyond the budget fails; shrink passes and reports", () => {
  const files = [
    { path: "apps/web/lib/x.ts", source: "return { ok: true };\nreturn { ok: true, data };" },
  ];
  const grown = runCheck({ files, baseline: baseline({ inlineOkTrueTotal: 1 }), today: "2026-08-16" });
  assert.equal(grown.ok, false);
  assert.equal(grown.inlineGrowth, 1);

  const shrunk = runCheck({ files, baseline: baseline({ inlineOkTrueTotal: 5 }), today: "2026-08-16" });
  assert.equal(shrunk.ok, true);
  assert.equal(shrunk.inlineOkTrueTotal, 2);
});

test("baseline contract: version/owner/expiry (expired fails)/shapes", () => {
  assert.deepEqual(validateBaseline(baseline(), { today: "2026-08-16" }), []);
  assert.match(
    validateBaseline(baseline({ expiry: "2026-01-01" }), { today: "2026-08-16" })[0],
    /expired/,
  );
  assert.match(
    validateBaseline(baseline({ inlineOkTrueTotal: -1 }), { today: "2026-08-16" })[0],
    /inlineOkTrueTotal/,
  );
  assert.match(
    validateBaseline(baseline({ localAliases: "nope" }), { today: "2026-08-16" })[0],
    /localAliases/,
  );
});
