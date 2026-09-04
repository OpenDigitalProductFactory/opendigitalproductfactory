// BI-BD81682A (EP-UX-SYSTEM L4) — the wall-of-text gate's verdict logic.
//
// The gate's brain is pure on purpose: the Playwright driver measures, this decides.
// So the load-bearing behaviour — "adding 400 words to a cockpit fails the build" — is
// provable here without a browser, a database or a production build.
import { describe, expect, it } from "vitest";

import {
  compareBaselineReproducibility,
  evaluateSweep,
  formatSweepReport,
  freezeBaseline,
  mergeReproducibleBaselines,
  normaliseSnapshot,
  normaliseVolatileText,
  summariseStructureDiff,
  STRUCTURE_DIFF_LIMIT,
  verdictForRoute,
  type BaselineFile,
  type RouteMeasurement,
  findNotReproducibleBlocking,
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

  it("passes when a legacy route adds a compliant lead band", () => {
    const leadCopy = "clear next step ".repeat(10);
    const before = measurement({ html: `<main><h1>Your day</h1><p>${leadCopy}</p></main>` });
    const after = measurement({ html: `<main data-dpf-lead><h1>Your day</h1><p>${leadCopy}</p></main>` });

    const v = verdictForRoute(after, baselineFrom(before).routes["/workspace"]);
    expect(v.ok, v.regressions.join("; ")).toBe(true);
    expect(v.regressions.join(" ")).not.toMatch(/lead-band words/);
  });

  it("catches when a legacy route removes its established lead band", () => {
    const leadCopy = "clear next step ".repeat(10);
    const before = measurement({ html: `<main data-dpf-lead><h1>Your day</h1><p>${leadCopy}</p></main>` });
    const after = measurement({ html: `<main><h1>Your day</h1><p>${leadCopy}</p></main>` });

    const v = verdictForRoute(after, baselineFrom(before).routes["/workspace"]);
    expect(v.ok).toBe(false);
    expect(v.regressions.join(" ")).toMatch(/lead-band words/);
  });

  it("does not punish shorter lead-band copy while the lead band remains present", () => {
    const before = measurement({ html: `<main data-dpf-lead><h1>Your day</h1><p>${"word ".repeat(40)}</p></main>` });
    const after = measurement({ html: `<main data-dpf-lead><h1>Your day</h1><p>Two things need you.</p></main>` });

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

  it("projects to structure only — nesting + role + structural state", () => {
    const snap = [
      "- banner:",
      '  - link "OD Open Digital Product Factory":',
      "    - /url: /workspace",
      '  - heading "Your day" [level=1]',
      "  - text: · updated 7/23/2026, 7:37:21 PM (seeded)",
    ].join("\n");
    // Names, URLs and text payloads are dropped; nesting, role and [level] survive.
    expect(normaliseSnapshot(snap)).toBe(
      ["- banner", "  - link", "  - heading [level=1]", "  - text"].join("\n"),
    );
  });

  it("drops the toast portal — top-level chrome after the page's own landmarks", () => {
    // The measured case: one run's tail was `alert`, its twin's was `button` then
    // `alert`. The dismiss control is a SIBLING of the alert and can precede it, so
    // neither subtree-skipping nor "stop at the first live region" catches it.
    const withToast = ["- banner:", "- main:", '  - heading "x" [level=1]', "- button", "- alert"].join("\n");
    const withoutToast = ["- banner:", "- main:", '  - heading "x" [level=1]', "- alert"].join("\n");
    expect(normaliseSnapshot(withToast)).toBe(normaliseSnapshot(withoutToast));
    expect(normaliseSnapshot(withToast)).toBe(["- banner", "- main", "  - heading [level=1]"].join("\n"));
  });

  it("keeps real landmarks that legitimately follow main", () => {
    const snap = ["- main:", '  - heading "x" [level=1]', "- contentinfo:", "  - link"].join("\n");
    expect(normaliseSnapshot(snap)).toContain("- contentinfo");
  });

  it("excludes a nested live region's whole subtree", () => {
    const snap = ["- main:", "  - status:", '    - button "Retry"', '  - heading "x" [level=1]'].join("\n");
    expect(normaliseSnapshot(snap)).toBe(["- main", "  - heading [level=1]"].join("\n"));
  });

  it("collapses repeated sibling subtrees — a list's LENGTH is data, not shape", () => {
    // /build/work was the measured case: a table whose row count differed between two
    // runs of the same commit. Rows ARE structure, so no text normalisation fixes it;
    // N identically-shaped rows must project as one.
    const oneRow = "- table:\n  - row:\n    - cell";
    const manyRows = "- table:\n  - row:\n    - cell\n  - row:\n    - cell\n  - row:\n    - cell";
    expect(normaliseSnapshot(manyRows)).toBe(normaliseSnapshot(oneRow));
  });

  it("stays sensitive to the hierarchy questions the gate exists to ask", () => {
    const n = normaliseSnapshot;
    // A new KIND of node inside a row (e.g. an action button appears).
    expect(n("- row:\n  - cell")).not.toBe(n("- row:\n  - cell\n  - button"));
    // A heading flattened into plain text — the Design2Code failure mode.
    expect(n("- main:\n  - heading [level=2]")).not.toBe(n("- main:\n  - text"));
    // A landmark disappears.
    expect(n("- banner\n- main")).not.toBe(n("- main"));
    // Nesting depth changes (a list item promoted out of its list).
    expect(n("- main:\n  - list:\n    - listitem")).not.toBe(n("- main:\n  - list\n  - listitem"));
    // Structural state changes.
    expect(n("- main:\n  - button [pressed]")).not.toBe(n("- main:\n  - button"));
  });

  it("two runs that differ ONLY in rendered text project identically", () => {
    // The measured cause of the drift: seeded rows render "updated <now>". This is
    // the case that made 91 of 200 routes look structurally changed between runs.
    const at = (t: string) => `- main:\n  - text: · updated 7/23/2026, ${t} (seeded)`;
    expect(normaliseSnapshot(at("7:37:21 PM"))).toBe(normaliseSnapshot(at("8:27:13 PM")));
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

  it("redacts secret-shaped labels the live DOM can carry (PEM headers, JWTs)", () => {
    // Integration-setup screens show a 'paste your key' field labelled with a PEM
    // header; it is a UI label, not a secret, but must not be stored verbatim.
    // The inputs are assembled from fragments so this test file contains no
    // contiguous secret-shaped literal for the secret scanner to flag.
    const header = `-----BEGIN ${"PRIVATE"} KEY-----`;
    const pem = normaliseSnapshot(`- textbox "${header}"`);
    // Projection drops the accessible name entirely — stronger than redacting it.
    expect(pem).not.toContain("BEGIN PRIVATE KEY");
    expect(pem).toBe("- textbox");
    const jwtInput = ["eyJ" + "hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "SflKxwRJSMeKKF2QT4fwpMe"].join(".");
    const jwt = normaliseSnapshot(`- text ${jwtInput}`);
    expect(jwt).not.toContain("eyJzdWIiOiIxMjM0");
    expect(jwt).toBe("- text");
  });
});

describe("volatile text normalisation stabilises word counts (BI-EA221325)", () => {
  const words = (s: string) => normaliseVolatileText(s).split(/\s+/).filter(Boolean).length;

  it("collapses relative times to one token, so the count stops moving", () => {
    // The ±2 word deltas: "2 hours ago" (3 words) vs "just now" (2 words).
    expect(words("updated 2 hours ago")).toBe(words("updated just now"));
    expect(words("updated 11 minutes ago")).toBe(words("updated a moment ago"));
  });

  it("collapses clock times and dates regardless of digit width", () => {
    expect(normaliseVolatileText("7:37:21 PM")).toBe(normaliseVolatileText("11:05:03 AM"));
    expect(normaliseVolatileText("7/23/2026")).toBe(normaliseVolatileText("11/1/26"));
    expect(words("· updated 7/23/2026, 7:37:21 PM (seeded)")).toBe(
      words("· updated 11/1/26, 11:05:03 AM (seeded)"),
    );
  });

  it("leaves ordinary prose alone", () => {
    const prose = "Two things need your attention today";
    expect(normaliseVolatileText(prose)).toBe(prose);
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

describe("same-SHA baseline reproducibility", () => {
  const source = freezeBaseline([
    measurement({ routePath: "/a", html: "<main><p>one two three</p></main>" }),
  ], "test");

  it("accepts only the measured word floor and merges its conservative envelope", () => {
    const twin = structuredClone(source);
    twin.routes["/a"].defaultVisibleWords += 2;

    expect(compareBaselineReproducibility(source, twin)).toEqual([]);
    expect(mergeReproducibleBaselines(source, twin).routes["/a"].defaultVisibleWords).toBe(
      twin.routes["/a"].defaultVisibleWords,
    );
  });

  it("rejects word drift above the floor", () => {
    const twin = structuredClone(source);
    twin.routes["/a"].defaultVisibleWords += 3;

    expect(compareBaselineReproducibility(source, twin)).toMatchObject([
      { routePath: "/a", axis: "defaultVisibleWords" },
    ]);
    expect(() => mergeReproducibleBaselines(source, twin)).toThrow(/not reproducible/i);
  });

  it("rejects structure drift and incomplete route accounting", () => {
    const changed = structuredClone(source);
    changed.routes["/a"].ariaSnapshot =
      "- banner\n- main\n  - heading [level=1]\n  - link";
    expect(compareBaselineReproducibility(source, changed)).toMatchObject([
      { routePath: "/a", axis: "ariaSnapshot" },
    ]);

    const missing = structuredClone(source);
    delete missing.routes["/a"];
    expect(compareBaselineReproducibility(source, missing)).toMatchObject([
      { routePath: "/a", axis: "route", second: "missing" },
    ]);
  });
});

describe("structural diff reporting", () => {
  // Why this exists: a structureChanged failure used to report only THAT the shape
  // moved. The report artifact carries no snapshot, so diagnosing one meant
  // reproducing the route against a live portal by hand (the /platform/ai/
  // operations-map investigation, PR #3901). The diff makes it readable from CI.

  it("names the landmark that disappeared", () => {
    const before = measurement({ ariaSnapshot: "- banner\n- main:\n  - heading [level=1]" });
    const after = measurement({ ariaSnapshot: "- main:\n  - heading [level=1]" });

    const v = verdictForRoute(after, baselineFrom(before).routes["/workspace"]);
    expect(v.structureChanged).toBe(true);
    expect(v.structureDiff).toContain("[-] banner");
  });

  it("names a heading that flattened into text", () => {
    const before = measurement({ ariaSnapshot: "- main:\n  - heading [level=2]" });
    const after = measurement({ ariaSnapshot: "- main:\n  - text" });

    const v = verdictForRoute(after, baselineFrom(before).routes["/workspace"]);
    expect(v.structureDiff.map((d) => d.trim())).toEqual(
      expect.arrayContaining(["[-] heading [level=2]", "[+] text"]),
    );
  });

  it("stays EMPTY when the structure held — no diff noise on a passing route", () => {
    const m = measurement();
    const v = verdictForRoute(m, baselineFrom(m).routes["/workspace"]);
    expect(v.structureChanged).toBe(false);
    expect(v.structureDiff).toEqual([]);
  });

  it("reports nothing for row-count churn, because the gate ignores it too", () => {
    // The diff must describe what the gate COMPARED, not the raw tree — otherwise it
    // sends the reader chasing repetition that collapseRepeatedSiblings discarded.
    const oneRow = "- table:\n  - row:\n    - cell";
    const manyRows = "- table:\n  - row:\n    - cell\n  - row:\n    - cell";
    const v = verdictForRoute(
      measurement({ ariaSnapshot: manyRows }),
      baselineFrom(measurement({ ariaSnapshot: oneRow })).routes["/workspace"],
    );
    expect(v.structureChanged).toBe(false);
    expect(v.structureDiff).toEqual([]);
  });

  it("truncates a large diff instead of flooding the log", () => {
    const before = measurement({ ariaSnapshot: "- main:\n  - heading [level=1]" });
    const after = measurement({
      ariaSnapshot: [
        "- main:",
        ...Array.from({ length: 40 }, (_, i) => `  - heading [level=${(i % 6) + 1}]`),
      ].join("\n"),
    });

    const diff = verdictForRoute(after, baselineFrom(before).routes["/workspace"]).structureDiff;
    expect(diff.length).toBe(STRUCTURE_DIFF_LIMIT + 1);
    expect(diff[diff.length - 1]).toMatch(/more structural line\(s\)/);
  });

  it("surfaces the diff in the human report under the REGRESSION line", () => {
    const before = measurement({ ariaSnapshot: "- banner\n- main:\n  - heading [level=1]" });
    const after = measurement({ ariaSnapshot: "- main:\n  - heading [level=1]" });

    const report = formatSweepReport(evaluateSweep([after], baselineFrom(before)));
    expect(report).toMatch(/accessibility tree changed shape/);
    expect(report).toMatch(/\[-\] banner/);
  });

  it("still reports a first-divergence hint when the projection is too large to diff", () => {
    // Distinct adjacent roles so collapseRepeatedSiblings cannot shrink it, nested
    // under main so the projection keeps them.
    const wide = (n: number) =>
      Array.from({ length: n }, (_, i) => `  - heading [level=${(i % 6) + 1}]`).join("\n");
    const diff = summariseStructureDiff(
      `- banner\n- main:\n${wide(2100)}`,
      `- main:\n${wide(2100)}`,
    );
    expect(diff.join(" ")).toMatch(/first divergence|too large/);
  });
});

describe("findNotReproducibleBlocking (BI-69FE5504)", () => {
  it("clears a blocking verdict that did not survive the second measurement", () => {
    // The live case: a route rendering from unpinned DB state blocked a PR that
    // touched only a Dockerfile and shell scripts, then passed on re-run.
    expect(
      findNotReproducibleBlocking({
        firstPassBlocking: ["/storefront/settings/operations"],
        confirmPassBlocking: [],
        unmeasuredOnConfirm: [],
      }),
    ).toEqual(["/storefront/settings/operations"]);
  });

  it("keeps a verdict that reproduces — a real regression is deterministic", () => {
    expect(
      findNotReproducibleBlocking({
        firstPassBlocking: ["/platform/tools/integrations"],
        confirmPassBlocking: ["/platform/tools/integrations"],
        unmeasuredOnConfirm: [],
      }),
    ).toEqual([]);
  });

  it("keeps a verdict when the route could not be re-measured — silence is not stability", () => {
    expect(
      findNotReproducibleBlocking({
        firstPassBlocking: ["/timeouts"],
        confirmPassBlocking: [],
        unmeasuredOnConfirm: ["/timeouts"],
      }),
    ).toEqual([]);
  });

  it("separates the flaky from the real in one mixed run, deterministically ordered", () => {
    expect(
      findNotReproducibleBlocking({
        firstPassBlocking: ["/b-flaky", "/a-real", "/c-flaky", "/a-real"],
        confirmPassBlocking: ["/a-real"],
        unmeasuredOnConfirm: [],
      }),
    ).toEqual(["/b-flaky", "/c-flaky"]);
  });
});
