// scripts/check-ux-fit-decision.test.mjs
// BI-D967DEE0: permanent red/green fixtures for the UX-Fit measured-evidence gate.
//
// The load-bearing assertion in this file is "attestation theater is rejected BY NAME":
// the Phase-2 gate this replaces passed any PR carrying a plausible trailer, so the
// regression to guard is an acknowledgement dressed as evidence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  MEASURED_AXES,
  UI_CONTROL_RE,
  checkMeasurementAgainstBaseline,
  manifestPathsFromDiff,
  routePathForPageFile,
  runGate,
  validateManifest,
} from "./check-ux-fit-decision.mjs";

const FIXTURES = new URL("../docs/testing/fixtures/ux-fit/", import.meta.url);
const load = (name) => JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8"));

const PAGE = "apps/web/app/(shell)/example/page.tsx";

// A small synthetic baseline: the real 200-route file moves every sweep, and these
// fixtures must stay stable.
const BASELINE = {
  bootstrapped: true,
  routes: {
    "/example": {
      defaultVisibleWords: 200,
      leadBandWords: 50,
      primaryActions: 3,
      visibleFields: 6,
      maxChoicesPerControl: 8,
      subLegibleControls: 0,
      buriedPrimaryAction: 0,
      axeViolations: 1,
    },
  },
};

// ── green fixtures validate ──

test("a sweep-measurement manifest that improves on the baseline is valid", () => {
  const m = load("green-sweep-measurement.ux-fit.json");
  assert.deepEqual(validateManifest(m), []);
  assert.deepEqual(checkMeasurementAgainstBaseline(m, BASELINE), []);
});

test("a propose-n-pick manifest with a recorded id and real options is valid", () => {
  assert.deepEqual(validateManifest(load("green-propose-n-pick.ux-fit.json")), []);
});

test("a green manifest passes the whole gate for the file it scopes", () => {
  const result = runGate({
    impactingFiles: [PAGE],
    manifests: [{ path: "docs/ux-fit/x.ux-fit.json", manifest: load("green-sweep-measurement.ux-fit.json") }],
    baseline: BASELINE,
  });
  assert.equal(result.ok, true, result.errors.join("; "));
});

// ── red fixtures fail for their intended reason ──

test("an acknowledgement is rejected as attestation theater, by name", () => {
  const errors = validateManifest(load("red-budgets-acknowledged.ux-fit.json"));
  assert.ok(errors.some((e) => /attestation theater/.test(e)), errors.join("; "));
  assert.ok(errors.some((e) => /budgets-acknowledged/.test(e)));
});

test("sweep-measurement with omitted axes fails per missing axis", () => {
  const errors = validateManifest(load("red-missing-axes.ux-fit.json"));
  // Every axis the fixture omits must be named, so the author knows what to measure.
  for (const axis of MEASURED_AXES.filter((a) => !["defaultVisibleWords", "primaryActions"].includes(a))) {
    assert.ok(errors.some((e) => e.includes(axis)), `expected an error naming ${axis}`);
  }
  assert.ok(errors.some((e) => /measure it, don't omit it/.test(e)));
});

test("a pick among one option is not a choice, and needs a recorded id", () => {
  const errors = validateManifest(load("red-single-option-pick.ux-fit.json"));
  assert.ok(errors.some((e) => /at least 2 entries/.test(e)), errors.join("; "));
  assert.ok(errors.some((e) => /decisionInteractionId/.test(e)));
});

test("measured numbers that regress the committed baseline are rejected per axis", () => {
  const m = load("red-regresses-baseline.ux-fit.json");
  // Shape is fine — this fixture exists to prove ADJUDICATION bites, not validation.
  assert.deepEqual(validateManifest(m), []);
  const errors = checkMeasurementAgainstBaseline(m, BASELINE);
  assert.ok(errors.some((e) => /defaultVisibleWords: 200 -> 900/.test(e)), errors.join("; "));
  assert.ok(errors.some((e) => /subLegibleControls/.test(e)));
  assert.ok(errors.some((e) => /buriedPrimaryAction/.test(e)));
});

// ── the retirement itself ──

test("a UI-impacting change with NO manifest fails and says the trailer is retired", () => {
  const result = runGate({ impactingFiles: [PAGE], manifests: [], baseline: BASELINE });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /trailer was retired/.test(e)), result.errors.join("; "));
});

test("UI control detection includes buttons, links, disclosures, and custom triggers", () => {
  const shouldMatch = [
    "<button type=\"button\">Save</button>",
    "<a href=\"/customer\">Customer</a>",
    "<Link href=\"/workspace\">Workspace</Link>",
    "<details>",
    "<summary>Advanced</summary>",
    "<SubmitButton pending={pending} />",
    "<DropdownMenuTrigger asChild>",
    "<div role=\"button\" onClick={open}>Open</div>",
    "<PanelHeader aria-expanded={open}>",
    "<section data-dpf-disclosure>",
  ];

  for (const text of shouldMatch) {
    assert.equal(UI_CONTROL_RE.test(text), true, `expected UI_CONTROL_RE to match ${text}`);
  }

  assert.equal(UI_CONTROL_RE.test("<div>plain status</div>"), false);
});

test("a trailer-shaped manifest cannot smuggle an acknowledgement through the gate", () => {
  const result = runGate({
    impactingFiles: [PAGE],
    manifests: [{ path: "docs/ux-fit/x.ux-fit.json", manifest: load("red-budgets-acknowledged.ux-fit.json") }],
    baseline: BASELINE,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /attestation theater/.test(e)));
});

// ── manifest-vs-diff consistency, both directions ──

test("an impacting file no manifest scopes is reported as uncovered", () => {
  const result = runGate({
    impactingFiles: [PAGE, "apps/web/app/(shell)/other/page.tsx"],
    manifests: [{ path: "docs/ux-fit/x.ux-fit.json", manifest: load("green-sweep-measurement.ux-fit.json") }],
    baseline: BASELINE,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /other\/page\.tsx is UI-impacting but no/.test(e)), result.errors.join("; "));
});

test("a manifest scoping a file that is not in the diff is rejected as stale/over-broad", () => {
  const stale = load("green-sweep-measurement.ux-fit.json");
  stale.scope.files = [PAGE, "apps/web/app/(shell)/unrelated/page.tsx"];
  const result = runGate({
    impactingFiles: [PAGE],
    manifests: [{ path: "docs/ux-fit/x.ux-fit.json", manifest: stale }],
    baseline: BASELINE,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /stale or over-broad/.test(e)), result.errors.join("; "));
});

test("no UI-impacting change is a clean pass with nothing required", () => {
  const result = runGate({ impactingFiles: [], manifests: [], baseline: BASELINE });
  assert.equal(result.ok, true);
});

test("unreadable JSON surfaces as a manifest error rather than passing silently", () => {
  const result = runGate({
    impactingFiles: [PAGE],
    manifests: [{ path: "docs/ux-fit/broken.ux-fit.json", manifest: null }],
    baseline: BASELINE,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /manifest is not an object/.test(e)));
});

// ── new-route handling ──

test("a route absent from the baseline must declare itself new", () => {
  const m = load("green-sweep-measurement.ux-fit.json");
  const errors = checkMeasurementAgainstBaseline(m, { routes: {} });
  assert.ok(errors.some((e) => /not in the committed budget baseline/.test(e)), errors.join("; "));
});

test("declaring new-route for a route already in the baseline is rejected", () => {
  const m = load("green-sweep-measurement.ux-fit.json");
  m.evidence.baselineComparison = "new-route";
  const errors = checkMeasurementAgainstBaseline(m, BASELINE);
  assert.ok(errors.some((e) => /already in the\s+committed baseline/.test(e)), errors.join("; "));
});

test("a genuinely new route passes adjudication when declared", () => {
  const m = load("green-sweep-measurement.ux-fit.json");
  m.evidence.baselineComparison = "new-route";
  assert.deepEqual(checkMeasurementAgainstBaseline(m, { routes: {} }), []);
});

// ── fixtures are not evidence ──
//
// Regression test for a defect the unit tests could not see: they inject manifests
// directly, so only an end-to-end run revealed that this very directory was being
// discovered as candidate evidence — making every PR that touched a fixture inherit the
// red fixtures' intended failures, and letting a green fixture pose as coverage.
test("test fixtures are excluded from manifest discovery", () => {
  const diff = [
    "docs/testing/fixtures/ux-fit/red-budgets-acknowledged.ux-fit.json",
    "docs/testing/fixtures/ux-fit/green-sweep-measurement.ux-fit.json",
    "docs/ux-fit/2026-07-30-real-decision.ux-fit.json",
    "apps/web/app/(shell)/example/page.tsx",
  ];
  assert.deepEqual(manifestPathsFromDiff(diff), ["docs/ux-fit/2026-07-30-real-decision.ux-fit.json"]);
});

test("a PR touching only fixtures offers no evidence for a UI change", () => {
  const paths = manifestPathsFromDiff(["docs/testing/fixtures/ux-fit/green-sweep-measurement.ux-fit.json"]);
  assert.deepEqual(paths, []);
  const result = runGate({ impactingFiles: [PAGE], manifests: [], baseline: BASELINE });
  assert.equal(result.ok, false);
});

// ── route mapping ──

test("route groups contribute no path segment; dynamic segments survive", () => {
  assert.equal(routePathForPageFile("apps/web/app/(shell)/ops/page.tsx"), "/ops");
  assert.equal(routePathForPageFile("apps/web/app/(shell)/build/[id]/page.tsx"), "/build/[id]");
  assert.equal(routePathForPageFile("apps/web/lib/whatever.ts"), null);
});
