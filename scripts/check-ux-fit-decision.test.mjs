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
  addedLinesContainVisibleCopy,
  collectCopyPreservingRenames,
  MEASURED_AXES,
  MEASURED_AXIS_POLARITY,
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

test("the introducing 686-word tax measurement cannot pass against the stale 684 row", () => {
  const manifest = load("green-sweep-measurement.ux-fit.json");
  manifest.evidence.measured["/example"].defaultVisibleWords = 686;
  const baseline = {
    ...BASELINE,
    routes: {
      "/example": { ...BASELINE.routes["/example"], defaultVisibleWords: 684 },
    },
  };

  const errors = checkMeasurementAgainstBaseline(manifest, baseline);
  assert.ok(errors.some((error) => /defaultVisibleWords: 684 -> 686/.test(error)), errors.join("; "));
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

test("added user-visible copy is UX-impacting even when it adds no control", () => {
  assert.equal(addedLinesContainVisibleCopy(["+      <div>plain status</div>"]), true);
  assert.equal(
    addedLinesContainVisibleCopy([
      '+  { value: "withheld", label: "Withheld" },',
      '+  { value: "employer", label: "Employer" },',
    ]),
    true,
  );
});

test("imports and styling-only additions are not mistaken for visible copy", () => {
  assert.equal(
    addedLinesContainVisibleCopy([
      '+import { TaxCard } from "@/components/finance/tax-card";',
      '+      <div className="flex gap-2 text-sm">{children}</div>',
    ]),
    false,
  );
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

// ── axis polarity (BI-E7F6C76E) ──

test("a route adding its first lead band is an improvement, not a regression", () => {
  // The change this whole programme exists to cause. leadBandWords 0 -> 31 was
  // reported as a regression here even after lib/ux-budget/ratchet.ts stopped
  // doing so, because this gate mirrored the axis LIST and not the polarity map.
  const errors = checkMeasurementAgainstBaseline(
    {
      evidence: {
        kind: "sweep-measurement",
        baselineComparison: "improved",
        measured: {
          "/example": {
            defaultVisibleWords: 120,
            leadBandWords: 31,
            primaryActions: 1,
            visibleFields: 3,
            maxChoicesPerControl: 3,
            subLegibleControls: 0,
            buriedPrimaryAction: 0,
            axeViolations: 1,
          },
        },
      },
    },
    { ...BASELINE, routes: { "/example": { ...BASELINE.routes["/example"], leadBandWords: 0 } } },
  );
  assert.deepEqual(errors, []);
});

test("a route LOSING its lead band still regresses", () => {
  // The presence axis is not a free pass: dropping to zero is the real failure.
  const errors = checkMeasurementAgainstBaseline(
    {
      evidence: {
        kind: "sweep-measurement",
        baselineComparison: "improved",
        measured: {
          "/example": {
            defaultVisibleWords: 120,
            leadBandWords: 0,
            primaryActions: 1,
            visibleFields: 3,
            maxChoicesPerControl: 3,
            subLegibleControls: 0,
            buriedPrimaryAction: 0,
            axeViolations: 1,
          },
        },
      },
    },
    BASELINE,
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /leadBandWords/);
});

test("polarity does not drift from lib/ux-budget/ratchet.ts", () => {
  // This gate and the ratchet compare the SAME numbers against the SAME frozen
  // baseline, so a polarity fix in one that misses the other reintroduces exactly
  // the BI-E7F6C76E failure. Pin them together rather than trusting a comment.
  const ratchet = readFileSync("apps/web/lib/ux-budget/ratchet.ts", "utf8");
  const block = /RATCHET_AXIS_POLARITY[^=]*=\s*\{([^}]*)\}/.exec(ratchet);
  assert.ok(block, "could not find RATCHET_AXIS_POLARITY in ratchet.ts");
  const source = Object.fromEntries(
    [...block[1].matchAll(/(\w+)\s*:\s*"(max|presence)"/g)].map((m) => [m[1], m[2]]),
  );
  assert.deepEqual(MEASURED_AXIS_POLARITY, source);
  assert.deepEqual(Object.keys(MEASURED_AXIS_POLARITY).sort(), [...MEASURED_AXES].sort());
});

// ── Renamed components (BI-C2C16582) ────────────────────────────────────────────
//
// A `git mv` reads as delete+add without rename detection, so a pure rename used to
// demand fresh measured UX evidence for a screen nobody changed. The exemption is
// narrow ON PURPOSE: it forgives a move that introduces no new user-visible copy,
// and nothing else. These fixtures pin both halves — especially that a rename which
// DOES add copy still has to prove its fit, which is what stops the exemption from
// becoming a way to smuggle UI in behind a file move.

function fakeGit(nameStatus, bodies) {
  return (...args) => {
    if (args.includes("--name-status")) return nameStatus;
    const newPath = args[args.length - 1];
    return bodies[newPath] ?? "";
  };
}

test("a rename that only re-cases identifiers is exempt", () => {
  const ns = "R093\tapps/web/a/WorkRoomHeader.tsx\tapps/web/a/WorkroomHeader.tsx";
  const body = [
    '-import { WorkRoomView } from "@/lib/work-management/room-types";',
    '+import { WorkroomView } from "@/lib/work-management/room-types";',
    '-  <div data-testid="workRoomOutcomeHealth">Outcome health</div>',
    '+  <div data-testid="workroomOutcomeHealth">Outcome health</div>',
  ].join("\n");
  const out = collectCopyPreservingRenames("base", fakeGit(ns, { "apps/web/a/WorkroomHeader.tsx": body }));
  assert.equal(out.has("apps/web/a/WorkroomHeader.tsx"), true);
});

test("a rename that ADDS user-visible copy is NOT exempt", () => {
  const ns = "R090\tapps/web/a/WorkRoomHeader.tsx\tapps/web/a/WorkroomHeader.tsx";
  const body = [
    '-  <div data-testid="workRoomOutcomeHealth">Outcome health</div>',
    '+  <div data-testid="workroomOutcomeHealth">Outcome health</div>',
    '+  <button>Archive this workroom</button>',
  ].join("\n");
  const out = collectCopyPreservingRenames("base", fakeGit(ns, { "apps/web/a/WorkroomHeader.tsx": body }));
  assert.equal(out.has("apps/web/a/WorkroomHeader.tsx"), false);
});

test("a plain added file is never treated as a rename", () => {
  const ns = "A\tapps/web/a/BrandNewPanel.tsx";
  const out = collectCopyPreservingRenames("base", fakeGit(ns, {}));
  assert.equal(out.size, 0);
});
