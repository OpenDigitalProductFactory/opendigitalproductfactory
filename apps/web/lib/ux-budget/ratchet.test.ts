// BI-BD81682A (EP-UX-SYSTEM L4) — the wall-of-text gate's verdict logic.
//
// The gate's brain is pure on purpose: the Playwright driver measures, this decides.
// So the load-bearing behaviour — "adding 400 words to a cockpit fails the build" — is
// provable here without a browser, a database or a production build.
import { describe, expect, it } from "vitest";

import {
  evaluateSweep,
  formatSweepReport,
  freezeBaseline,
  normaliseSnapshot,
  verdictForRoute,
  type BaselineFile,
  type RouteMeasurement,
} from "./ratchet";
import { measureUxBudget } from "./measure";

const SNAPSHOT = "- banner\n- main:\n  - heading \"Your day\" [level=1]\n";

function measurement(overrides: Partial<RouteMeasurement> & { html?: string } = {}): RouteMeasurement {
  const { html, ...rest } = overrides;
  return {
    routePath: "/workspace",
    shell: "cockpit",
    metrics: measureUxBudget(
      html ?? `<main data-dpf-lead><h1>Your day</h1><p>a short compliant surface</p></main>`,
    ),
    ariaSnapshot: SNAPSHOT,
    axeViolations: 0,
    ...rest,
  };
}

function baselineFrom(m: RouteMeasurement): BaselineFile {
  return freezeBaseline([m], "test");
}

describe("regression ratchet on a pre-existing route", () => {
  it("fails when a changed route exceeds its own frozen baseline", () => {
    const before = measurement();
    const baseline = baselineFrom(before);
    // The exact scenario this epic exists to stop.
    const after = measurement({ html: `<main data-dpf-lead><p>${"word ".repeat(400)}</p></main>` });

    const v = verdictForRoute(after, baseline.routes["/workspace"]);
    expect(v.routeStatus).toBe("pre-existing");
    expect(v.ok).toBe(false);
    expect(v.regressions.join(" ")).toMatch(/words visible on arrival/);
  });

  it("passes when the route is unchanged", () => {
    const m = measurement();
    expect(verdictForRoute(m, baselineFrom(m).routes["/workspace"]).ok).toBe(true);
  });

  it("passes when the route got SHORTER — the ratchet only resists growth", () => {
    const before = measurement({ html: `<main data-dpf-lead><p>${"word ".repeat(200)}</p></main>` });
    const after = measurement({ html: `<main data-dpf-lead><p>fewer words now</p></main>` });
    expect(verdictForRoute(after, baselineFrom(before).routes["/workspace"]).ok).toBe(true);
  });

  it("never blocks a pre-existing route on debt the PR did not make worse", () => {
    // A legacy surface that already violates its budget — over the word budget AND
    // over the deferred-detail threshold with no disclosure. Frozen as-is. An
    // unrelated PR must not fail on it, or the gate gets disabled within a week.
    const over = measurement({ html: `<main data-dpf-lead><p>${"word ".repeat(400)}</p></main>` });
    const v = verdictForRoute(over, baselineFrom(over).routes["/workspace"]);
    expect(v.regressions).toEqual([]);
    expect(v.blockingBudgetFailures).toEqual([]);
    expect(v.ok).toBe(true);
    // …but the debt is still reported every run, never silently forgiven.
    expect(v.advisoryBudgetFailures.length).toBeGreaterThan(0);
  });

  it("still catches that same debt the moment it GROWS", () => {
    const over = measurement({ html: `<main data-dpf-lead><p>${"word ".repeat(400)}</p></main>` });
    const worse = measurement({ html: `<main data-dpf-lead><p>${"word ".repeat(500)}</p></main>` });
    const v = verdictForRoute(worse, baselineFrom(over).routes["/workspace"]);
    expect(v.ok).toBe(false);
    expect(v.regressions.join(" ")).toMatch(/words visible on arrival: \d+ → \d+/);
  });

  it("catches a new sub-legible control on a legacy route via the ratchet", () => {
    // WCAG debt is held by the ratchet axis rather than by an absolute that would
    // fail every unrelated PR.
    const before = measurement({ html: `<main data-dpf-lead><button class="text-[9px]">a</button></main>` });
    const after = measurement({
      html: `<main data-dpf-lead><button class="text-[9px]">a</button><button class="text-[9px]">b</button></main>`,
    });
    const v = verdictForRoute(after, baselineFrom(before).routes["/workspace"]);
    expect(v.ok).toBe(false);
    expect(v.regressions.join(" ")).toMatch(/sub-legible controls: 1 → 2/);
  });

  it("treats more axe violations as a regression", () => {
    const before = measurement();
    const after = measurement({ axeViolations: 3 });
    const v = verdictForRoute(after, baselineFrom(before).routes["/workspace"]);
    expect(v.ok).toBe(false);
    expect(v.regressions.join(" ")).toMatch(/axe violations: 0 → 3/);
  });
});

describe("net-new routes cannot be born ugly (rev 2 D1)", () => {
  it("blocks a brand-new wall of text with no baseline to hide behind", () => {
    const v = verdictForRoute(
      measurement({ routePath: "/brand-new", html: `<main><p>${"word ".repeat(500)}</p></main>` }),
      undefined,
    );
    expect(v.routeStatus).toBe("net-new");
    expect(v.ok).toBe(false);
    expect(v.blockingBudgetFailures.length).toBeGreaterThan(0);
  });

  it("passes a brand-new route that respects its shell's budget", () => {
    const v = verdictForRoute(
      measurement({
        routePath: "/brand-new",
        html: `<main data-dpf-lead><h1>Today</h1><p>Two things need you.</p><button data-dpf-primary-action data-owner-first-next-action>Review</button></main>`,
      }),
      undefined,
    );
    expect(v.ok, v.blockingBudgetFailures.join("; ")).toBe(true);
  });
});

describe("buried primary action is a ratchet regression (BI-D77BF495)", () => {
  const reachable = `<main data-dpf-lead><h1>Self-Upgrade</h1><p>status</p><button data-dpf-primary-action data-owner-first-next-action>Upgrade now</button></main>`;
  const buried = `<main data-dpf-lead><h1>Self-Upgrade</h1><p>status</p><details><summary>Advanced</summary><button data-dpf-primary-action data-owner-first-next-action>Upgrade now</button></details></main>`;

  it("catches a pre-existing route that MOVES its primary action behind a collapse", () => {
    const before = measurement({ routePath: "/ops/self-upgrade", shell: "detail", html: reachable });
    const after = measurement({ routePath: "/ops/self-upgrade", shell: "detail", html: buried });
    const v = verdictForRoute(after, baselineFrom(before).routes["/ops/self-upgrade"]);
    expect(v.ok).toBe(false);
    expect(v.regressions.join(" ")).toMatch(/buried primary action/);
  });

  it("does not fail an unrelated PR on a route whose action was ALREADY buried", () => {
    const m = measurement({ routePath: "/ops/self-upgrade", shell: "detail", html: buried });
    // Baseline already has it buried (1); measuring it again is not a new regression.
    const v = verdictForRoute(m, baselineFrom(m).routes["/ops/self-upgrade"]);
    expect(v.regressions.join(" ")).not.toMatch(/buried primary action/);
  });
});

describe("structural hierarchy snapshot (rev 2 D2)", () => {
  it("flags a changed accessibility tree as a regression", () => {
    const before = measurement();
    const after = measurement({ ariaSnapshot: "- main:\n  - text \"Your day\"\n" }); // heading flattened
    const v = verdictForRoute(after, baselineFrom(before).routes["/workspace"]);
    expect(v.structureChanged).toBe(true);
    expect(v.ok).toBe(false);
  });

  it("ignores whitespace-only reformatting of the snapshot", () => {
    const before = measurement();
    const after = measurement({ ariaSnapshot: `${SNAPSHOT}\n\n  ` });
    expect(verdictForRoute(after, baselineFrom(before).routes["/workspace"]).structureChanged).toBe(false);
  });

  it("normalises trailing whitespace and blank lines", () => {
    expect(normaliseSnapshot("a  \n\n b \n")).toBe("a\n b");
  });

  it("redacts volatile values so a deploy does not read as a structure change", () => {
    // Same heading structure, different deploy SHA / count / timestamp / id.
    const a = normaliseSnapshot('- heading "Deployed: abc1234 · 1,234 runs · 2026-07-23" [level=2]');
    const b = normaliseSnapshot('- heading "Deployed: def5678 · 9,001 runs · 2026-07-22" [level=2]');
    expect(a).toBe(b);
    // The structural level is preserved (single digit, not a volatile token).
    expect(a).toContain("[level=2]");
    // And no raw SHA survives to trip secret scanning.
    expect(a).not.toContain("abc1234");
  });

  it("is idempotent — normalising a normalised snapshot changes nothing", () => {
    const once = normaliseSnapshot('- heading "build cafef00d, 4321 items"');
    expect(normaliseSnapshot(once)).toBe(once);
  });
});

describe("sweep-level verdict", () => {
  const measurements = [
    measurement({ routePath: "/a", html: `<main data-dpf-lead><p>${"w ".repeat(300)}</p></main>` }),
    measurement({ routePath: "/b", html: `<main data-dpf-lead><p>short</p></main>` }),
  ];

  it("never blocks while bootstrapping — there is no baseline to judge against", () => {
    const empty: BaselineFile = { bootstrapped: false, generator: "test", routes: {} };
    const sweep = evaluateSweep(measurements, empty);
    expect(sweep.blocked).toBe(false);
    // …and says so rather than passing quietly.
    expect(formatSweepReport(sweep)).toMatch(/BOOTSTRAP MODE/);
  });

  it("blocks once armed and a route regresses", () => {
    const frozen = freezeBaseline(measurements, "test");
    const worse = [
      measurement({ routePath: "/a", html: `<main data-dpf-lead><p>${"w ".repeat(900)}</p></main>` }),
      measurements[1],
    ];
    const sweep = evaluateSweep(worse, frozen);
    expect(sweep.blocked).toBe(true);
    expect(sweep.regressedRoutes).toEqual(["/a"]);
  });

  it("passes once armed when nothing changed", () => {
    expect(evaluateSweep(measurements, freezeBaseline(measurements, "test")).blocked).toBe(false);
  });

  it("identifies routes absent from the baseline as net-new", () => {
    const frozen = freezeBaseline([measurements[1]], "test");
    expect(evaluateSweep(measurements, frozen).netNewRoutes).toEqual(["/a"]);
  });

  it("ranks the league table worst-first by words (§7.1)", () => {
    const sweep = evaluateSweep(measurements, freezeBaseline(measurements, "test"));
    expect(sweep.leagueTable[0].routePath).toBe("/a");
    expect(sweep.leagueTable[0].words).toBeGreaterThan(sweep.leagueTable[1].words);
  });

  it("freezing is idempotent and sorted", () => {
    const frozen = freezeBaseline(measurements, "test");
    expect(Object.keys(frozen.routes)).toEqual(["/a", "/b"]);
    expect(freezeBaseline(measurements, "test")).toEqual(frozen);
    expect(frozen.bootstrapped).toBe(true);
  });
});
