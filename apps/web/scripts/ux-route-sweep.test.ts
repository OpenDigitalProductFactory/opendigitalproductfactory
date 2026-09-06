import { describe, expect, it } from "vitest";

import { resolveSweepPath } from "./ux-sweep-route-params";

import {
  BROWSER_EVALUATION_RUNTIME,
  DOM_SETTLE_EXPRESSION,
  captureAccessibilityStructure,
  executionOutcome,
  findDroppedBaselineRoutes,
  selectSweepRows,
  uxSweepAxeOptions,
  waitForRouteDomToSettle,
  withIsolatedSweepPage,
} from "./ux-route-sweep";
import {
  parseSweepWorkerCount,
  reconcileRouteAccounting,
  runBoundedRouteWork,
  serialiseSemanticStructure,
} from "./ux-route-sweep-runner";

describe("axe result collection", () => {
  it("preserves WCAG rule coverage while returning only the consumed result group", () => {
    expect(uxSweepAxeOptions()).toEqual({
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag22aa"],
      },
      resultTypes: ["violations"],
    });
  });
});

describe("targeted route selection", () => {
  const inventory = [
    { routePath: "/alpha", sweepEligible: true },
    { routePath: "/beta", sweepEligible: false },
    { routePath: "/gamma", sweepEligible: true },
  ] as never;

  it("keeps the full eligible inventory when no selector is supplied", () => {
    expect(selectSweepRows(inventory, "").map((row) => row.routePath)).toEqual([
      "/alpha",
      "/gamma",
    ]);
  });

  it("selects an explicit comma-separated changed-route set in inventory order", () => {
    expect(
      selectSweepRows(inventory, "/gamma,/alpha").map((row) => row.routePath),
    ).toEqual(["/alpha", "/gamma"]);
  });

  it("rejects unknown or ineligible routes instead of silently producing partial evidence", () => {
    expect(() => selectSweepRows(inventory, "/alpha,/missing,/beta")).toThrow(
      "unknown or ineligible route selector(s): /beta, /missing",
    );
  });
});

describe("findDroppedBaselineRoutes (BI-EE6E0CFC)", () => {
  it("names committed routes absent from a freeze so refresh cannot silently shrink", () => {
    const committed = {
      bootstrapped: true,
      generator: "test",
      routes: {
        "/workspace": {} as never,
        "/ops/self-upgrade": {} as never,
        "/admin/scheduled-jobs": {} as never,
        "/platform": {} as never,
      },
    };
    const frozen = {
      bootstrapped: true,
      generator: "test",
      routes: {
        "/platform": {} as never,
      },
    };
    expect(findDroppedBaselineRoutes(committed, frozen)).toEqual([
      "/admin/scheduled-jobs",
      "/ops/self-upgrade",
      "/workspace",
    ]);
  });

  it("returns empty when freeze covers every committed route", () => {
    const routes = { "/a": {} as never, "/b": {} as never };
    expect(
      findDroppedBaselineRoutes(
        { bootstrapped: true, generator: "test", routes },
        { bootstrapped: true, generator: "test", routes: { ...routes, "/c": {} as never } },
      ),
    ).toEqual([]);
  });
});

describe("route phase evidence", () => {
  it("keeps phase timings in the execution artifact without changing the budget measurement", () => {
    const phases = {
      navigationAndSettleMs: 10,
      visibleDomMs: 20,
      semanticStructureMs: 30,
      accessibilityScanMs: 40,
      budgetMeasurementMs: 50,
    };

    expect(
      executionOutcome({
        routePath: "/large",
        status: "measured",
        durationMs: 151,
        value: {
          phases,
          measurement: { axeViolations: 2 } as never,
        },
      }),
    ).toEqual({
      routePath: "/large",
      status: "measured",
      durationMs: 151,
      phases,
      axeViolations: 2,
    });
  });
});

describe("serialiseSemanticStructure", () => {
  it("keeps role hierarchy and structural state while dropping names", () => {
    expect(
      serialiseSemanticStructure([
        {
          role: "main",
          children: [
            { role: "heading", attributes: ["[level=1]"] },
            { role: "button", attributes: ["[expanded]"] },
          ],
        },
      ]),
    ).toBe(
      [
        "- main",
        "  - heading [level=1]",
        "  - button [expanded]",
      ].join("\n"),
    );
  });

  it("flattens generic wrappers without dropping their structural children", () => {
    expect(
      serialiseSemanticStructure([
        {
          role: null,
          children: [
            {
              role: null,
              children: [
                {
                  role: "navigation",
                  children: [{ role: "link" }],
                },
              ],
            },
          ],
        },
      ]),
    ).toBe(["- navigation", "  - link"].join("\n"));
  });
});

describe("withIsolatedSweepPage", () => {
  it("gives each route a fresh page and closes it after measurement", async () => {
    const events: string[] = [];
    let nextId = 0;
    const context = {
      newPage: async () => {
        const id = ++nextId;
        events.push(`open:${id}`);
        return {
          id,
          close: async () => {
            events.push(`close:${id}`);
          },
        };
      },
    };

    const first = await withIsolatedSweepPage(context, async (page) => {
      events.push(`measure:${page.id}`);
      return page.id;
    });
    const second = await withIsolatedSweepPage(context, async (page) => {
      events.push(`measure:${page.id}`);
      return page.id;
    });

    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(events).toEqual([
      "open:1",
      "measure:1",
      "close:1",
      "open:2",
      "measure:2",
      "close:2",
    ]);
  });

  it("closes the route page when measurement fails", async () => {
    let closed = false;
    const page = {
      close: async () => {
        closed = true;
      },
    };

    await expect(
      withIsolatedSweepPage(
        { newPage: async () => page },
        async () => {
          throw new Error("measurement failed");
        },
      ),
    ).rejects.toThrow("measurement failed");

    expect(closed).toBe(true);
  });
});

describe("captureAccessibilityStructure", () => {
  it("installs the cross-realm transpiler helper before evaluating the DOM projection", async () => {
    const evaluations: unknown[] = [];
    const page = {
      evaluate: async (expression: unknown) => {
        evaluations.push(expression);
        if (typeof expression === "string") return undefined;
        return [{ role: "main", children: [{ role: "heading", attributes: ["[level=1]"] }] }];
      },
    };

    await expect(
      captureAccessibilityStructure(page as never),
    ).resolves.toBe(["- main", "  - heading [level=1]"].join("\n"));
    expect(evaluations).toHaveLength(2);
    expect(evaluations[0]).toBe(BROWSER_EVALUATION_RUNTIME);
    expect(BROWSER_EVALUATION_RUNTIME).toContain("globalThis.__name");
    expect(typeof evaluations[1]).toBe("function");
  });
});

describe("waitForRouteDomToSettle", () => {
  it("uses a self-contained, bounded browser expression", async () => {
    const evaluations: unknown[] = [];
    const page = {
      evaluate: async (expression: unknown) => {
        evaluations.push(expression);
      },
    };

    await waitForRouteDomToSettle(page as never);

    expect(evaluations).toEqual([DOM_SETTLE_EXPRESSION]);
    expect(DOM_SETTLE_EXPRESSION).toContain("new MutationObserver");
    expect(DOM_SETTLE_EXPRESSION).toContain("deadlineMs = 10000");
    expect(DOM_SETTLE_EXPRESSION).toContain('[data-dpf-ux-settle="pending"]');
    expect(DOM_SETTLE_EXPRESSION).toContain("reject(new Error");
    expect(DOM_SETTLE_EXPRESSION).not.toContain("__name");
  });
});

describe("route sweep coordination", () => {
  it("runs bounded workers while preserving inventory order", async () => {
    const routes = ["/slow", "/fast", "/last"].map((routePath) => ({ routePath }));
    let active = 0;
    let maxActive = 0;

    const result = await runBoundedRouteWork(routes, 2, async (row) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, row.routePath === "/slow" ? 20 : 1));
      active -= 1;
      return `${row.routePath}:measured`;
    });

    expect(maxActive).toBe(2);
    expect(result.outcomes.map((outcome) => outcome.routePath)).toEqual([
      "/slow",
      "/fast",
      "/last",
    ]);
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual([
      "measured",
      "measured",
      "measured",
    ]);
    expect(result.accounting.complete).toBe(true);
  });

  it("records a route failure, completes the remaining inventory, and fails accounting", async () => {
    const routes = ["/a", "/broken", "/c"].map((routePath) => ({ routePath }));

    const result = await runBoundedRouteWork(routes, 2, async (row) => {
      if (row.routePath === "/broken") throw new Error("navigation interrupted");
      return row.routePath;
    });

    expect(result.outcomes).toHaveLength(3);
    expect(result.outcomes.find((outcome) => outcome.routePath === "/broken")).toMatchObject({
      status: "failed",
      reason: "navigation interrupted",
    });
    expect(result.accounting).toMatchObject({
      complete: false,
      expectedRouteCount: 3,
      measuredRouteCount: 2,
      failedRoutes: ["/broken"],
      missingRoutes: [],
      duplicateRoutes: [],
      unexpectedRoutes: [],
    });
  });

  it("detects duplicate, missing, and unexpected result rows", () => {
    expect(
      reconcileRouteAccounting(
        ["/a", "/b", "/c"],
        [
          { routePath: "/a", status: "measured" },
          { routePath: "/a", status: "measured" },
          { routePath: "/outside", status: "measured" },
        ],
      ),
    ).toMatchObject({
      complete: false,
      missingRoutes: ["/b", "/c"],
      duplicateRoutes: ["/a"],
      unexpectedRoutes: ["/outside"],
    });
  });

  it("rejects a silently empty eligible inventory", () => {
    expect(reconcileRouteAccounting([], [])).toMatchObject({
      complete: false,
      expectedRouteCount: 0,
      measuredRouteCount: 0,
    });
  });

  it("accepts only the measured 1/2/4 worker experiment values", () => {
    expect(parseSweepWorkerCount(undefined)).toBe(2);
    expect(parseSweepWorkerCount("1")).toBe(1);
    expect(parseSweepWorkerCount("2")).toBe(2);
    expect(parseSweepWorkerCount("4")).toBe(4);
    expect(() => parseSweepWorkerCount("3")).toThrow(/supported values are 1, 2, or 4/i);
    expect(() => parseSweepWorkerCount("many")).toThrow(/supported values are 1, 2, or 4/i);
  });
});


// BI-DE67A3EC — the sweep could only measure routes with no dynamic segment, so
// 87 routes (53 owner-facing) were unmeasurable: every DETAIL surface, which is
// where a word or field budget matters most. A gate that measures only list
// pages reports a green it has not earned.
describe("resolveSweepPath (BI-DE67A3EC)", () => {
  it("returns a static route unchanged", () => {
    expect(resolveSweepPath("/workspace/inbox", {})).toBe("/workspace/inbox");
    // Params present but irrelevant must not perturb a static route.
    expect(resolveSweepPath("/workspace/inbox", { "/a/[b]": "/a/1" })).toBe("/workspace/inbox");
  });

  it("substitutes the path the fixture minted for a dynamic route", () => {
    expect(
      resolveSweepPath("/workspace/cases/[caseKey]", {
        "/workspace/cases/[caseKey]": "/workspace/cases/ux-sweep%3Aux-sweep-case",
      }),
    ).toBe("/workspace/cases/ux-sweep%3Aux-sweep-case");
  });

  // The load-bearing half. Navigating the literal "[caseKey]" would 404 — or
  // worse, match a catch-all — and freeze a measurement for a page that does not
  // exist. An unresolvable route must stop the run, not become a number.
  it("throws rather than navigating an unresolved dynamic route", () => {
    expect(() => resolveSweepPath("/workspace/cases/[caseKey]", {})).toThrow(
      /sweep-eligible but the fixture published no path/,
    );
  });

  it("names the route and both remedies in the failure", () => {
    let message = "";
    try {
      resolveSweepPath("/ops/thing/[id]", {});
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("/ops/thing/[id]");
    expect(message).toContain("ux:sweep-fixture");
    expect(message).toContain("SWEEP_RESOLVABLE_DYNAMIC_ROUTES");
  });
});
