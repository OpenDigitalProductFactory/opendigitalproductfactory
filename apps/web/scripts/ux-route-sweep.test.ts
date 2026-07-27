import { describe, expect, it } from "vitest";

import {
  BROWSER_EVALUATION_RUNTIME,
  DOM_SETTLE_EXPRESSION,
  captureAccessibilityStructure,
  waitForRouteDomToSettle,
  withIsolatedSweepPage,
} from "./ux-route-sweep";
import {
  parseSweepWorkerCount,
  reconcileRouteAccounting,
  runBoundedRouteWork,
  serialiseSemanticStructure,
} from "./ux-route-sweep-runner";

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
    expect(DOM_SETTLE_EXPRESSION).toContain("deadlineMs = 5000");
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
