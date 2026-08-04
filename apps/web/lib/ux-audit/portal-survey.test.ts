import { describe, it, expect } from "vitest";
import {
  planSurvey,
  runSurvey,
  isSurveyable,
  verdictForFindings,
  dedupeFindings,
  BUTTON_DECISION_LENS,
  type RouteManifest,
  type RouteManifestEntry,
  type LensSpec,
  type AuditFinding,
  type UxFinding,
} from "./portal-survey";

function entry(partial: Partial<RouteManifestEntry> & { routePath: string }): RouteManifestEntry {
  return {
    kind: "page",
    segments: [],
    dynamicParams: [],
    file: `apps/web/app${partial.routePath}/page.tsx`,
    ...partial,
  };
}

const PAGE_LENS: LensSpec = { id: "accessibility", mode: "page", description: "axe page eval" };
const LENSES = [PAGE_LENS, BUTTON_DECISION_LENS];
const lensById = new Map(LENSES.map((l) => [l.id, l]));

function finding(sev: UxFinding["severity"], route: string, element = "el"): AuditFinding {
  return {
    severity: sev,
    category: "accessibility",
    element,
    issue: "x",
    recommendation: "y",
    route,
  };
}

describe("isSurveyable", () => {
  it("accepts a plain page route", () => {
    expect(isSurveyable(entry({ routePath: "/workspace" }))).toBe(true);
  });
  it("rejects API/handler routes", () => {
    expect(isSurveyable(entry({ routePath: "/api/x", kind: "route" }))).toBe(false);
  });
  it("rejects dynamic-param routes (can't visit without values)", () => {
    expect(isSurveyable(entry({ routePath: "/x/[id]", dynamicParams: ["id"] }))).toBe(false);
  });
  it("folds redirects by default, but includes them when asked", () => {
    const e = entry({ routePath: "/", redirectTo: "/welcome" });
    expect(isSurveyable(e)).toBe(false);
    expect(isSurveyable(e, { includeRedirects: true })).toBe(true);
  });
});

describe("verdictForFindings", () => {
  it("empty → pass", () => expect(verdictForFindings([])).toBe("pass"));
  it("minor → pass-with-minor", () =>
    expect(verdictForFindings([{ severity: "minor" }])).toBe("pass-with-minor"));
  it("important → concerns", () =>
    expect(verdictForFindings([{ severity: "minor" }, { severity: "important" }])).toBe("concerns"));
  it("critical → fail (worst wins)", () =>
    expect(
      verdictForFindings([{ severity: "minor" }, { severity: "critical" }, { severity: "important" }]),
    ).toBe("fail"));
});

describe("planSurvey", () => {
  const manifest: RouteManifest = {
    routes: [
      entry({ routePath: "/workspace" }),
      entry({ routePath: "/api/agent/send", kind: "route" }),
      entry({ routePath: "/", redirectTo: "/welcome" }),
      entry({ routePath: "/build/[id]", dynamicParams: ["id"] }),
      entry({ routePath: "/platform" }),
      entry({ routePath: "/knowledge" }),
    ],
  };

  it("keeps only surveyable routes and records why the rest were skipped", () => {
    const plan = planSurvey(manifest, { lenses: LENSES });
    expect(plan.entries.map((e) => e.route)).toEqual(["/knowledge", "/platform", "/workspace"]); // sorted, surveyable only
    const skippedReasons = Object.fromEntries(plan.skipped.map((s) => [s.route, s.reason]));
    expect(skippedReasons["/api/agent/send"]).toMatch(/not a page/);
    expect(skippedReasons["/build/[id]"]).toMatch(/dynamic params/);
    expect(skippedReasons["/"]).toMatch(/redirect/);
  });

  it("assigns page lenses to all, behavioral lenses only to coworker routes", () => {
    const plan = planSurvey(manifest, {
      lenses: LENSES,
      coworkerRoute: (r) => r === "/workspace",
    });
    const byRoute = Object.fromEntries(plan.entries.map((e) => [e.route, e.lenses]));
    expect(byRoute["/platform"]).toEqual(["accessibility"]);
    expect(byRoute["/workspace"]).toEqual(["accessibility", "coworker-button-decision"]);
  });

  it("honors the sample cap deterministically and records the overflow", () => {
    const plan = planSurvey(manifest, { lenses: LENSES, sample: 2 });
    expect(plan.entries.map((e) => e.route)).toEqual(["/knowledge", "/platform"]);
    expect(plan.skipped.some((s) => s.route === "/workspace" && /sample cap/.test(s.reason))).toBe(true);
  });
});

describe("dedupeFindings", () => {
  it("removes duplicates by route+element+category+lens", () => {
    const a = finding("minor", "/x", "btn");
    const b = { ...finding("minor", "/x", "btn"), lens: "page" };
    const c = { ...finding("minor", "/x", "btn"), lens: "coworker-button-decision" };
    const out = dedupeFindings([a, { ...a }, b, c]);
    // a and its clone collapse; b and c differ by lens.
    expect(out).toHaveLength(3);
  });
});

describe("runSurvey + aggregateReport", () => {
  const plan = {
    entries: [
      { route: "/workspace", lenses: ["accessibility", "coworker-button-decision"] },
      { route: "/platform", lenses: ["accessibility"] },
      { route: "/knowledge", lenses: ["accessibility"] },
    ],
    skipped: [],
  };

  it("runs injected evaluators, rolls up verdicts, and aggregates the portal report", async () => {
    const report = await runSurvey(
      plan,
      {
        page: async (route) =>
          route === "/platform" ? [finding("critical", route, "a")] : [],
        behavioral: async (route) =>
          route === "/workspace" ? [finding("important", route, "decision")] : [],
      },
      lensById,
    );
    expect(report.routeCount).toBe(3);
    expect(report.evaluatedRouteCount).toBe(3);
    const byRoute = Object.fromEntries(report.routes.map((r) => [r.route, r.verdict]));
    expect(byRoute["/platform"]).toBe("fail"); // critical
    expect(byRoute["/workspace"]).toBe("concerns"); // important (behavioral)
    expect(byRoute["/knowledge"]).toBe("pass");
    expect(report.portalVerdict).toBe("fail"); // worst route
    expect(report.verdictCounts).toMatchObject({ fail: 1, concerns: 1, pass: 1 });
    expect(report.findingCounts).toEqual({ critical: 1, important: 1, minor: 0 });
  });

  it("tags each finding with the route and lens that produced it", async () => {
    const report = await runSurvey(
      { entries: [{ route: "/workspace", lenses: ["coworker-button-decision"] }], skipped: [] },
      { behavioral: async (route) => [finding("minor", route, "d")] },
      lensById,
    );
    const f = report.routes[0]!.findings[0]!;
    expect(f.route).toBe("/workspace");
    expect(f.lens).toBe("coworker-button-decision");
  });

  it("a thrown evaluator degrades that route to a concerns+error entry, never aborts the run", async () => {
    const report = await runSurvey(
      plan,
      {
        page: async (route) => {
          if (route === "/platform") throw new Error("browser-use timeout");
          return [];
        },
      },
      lensById,
    );
    const platform = report.routes.find((r) => r.route === "/platform")!;
    expect(platform.verdict).toBe("concerns");
    expect(platform.error).toMatch(/browser-use timeout/);
    // The other routes still completed.
    expect(report.routes.find((r) => r.route === "/knowledge")!.verdict).toBe("pass");
  });

  it("skips a lens whose evaluator is absent without failing the route", async () => {
    const report = await runSurvey(
      { entries: [{ route: "/workspace", lenses: ["accessibility", "coworker-button-decision"] }], skipped: [] },
      { page: async () => [] }, // no behavioral evaluator provided
      lensById,
    );
    expect(report.routes[0]!.evaluated).toEqual({ page: true, behavioral: false });
    expect(report.routes[0]!.verdict).toBe("pass");
  });
});

describe("runSurvey — lens failure isolation", () => {
  const pageLens: LensSpec = { id: "page-evaluation", mode: "page", description: "page" };
  const lensById = new Map<string, LensSpec>([
    [pageLens.id, pageLens],
    [BUTTON_DECISION_LENS.id, BUTTON_DECISION_LENS],
  ]);
  const plan = {
    entries: [{ route: "/workspace", lenses: [pageLens.id, BUTTON_DECISION_LENS.id] }],
    skipped: [],
  };

  it("still runs the behavioral lens when the page lens throws", async () => {
    const behavioralFinding: UxFinding = {
      severity: "important",
      category: "semantic-html",
      element: '[data-testid="agent-decision"]',
      issue: "no buttons",
      recommendation: "emit the sentinel",
    };

    const report = await runSurvey(
      plan,
      {
        page: async () => {
          throw new Error("evaluate_page did NOT RUN");
        },
        behavioral: async () => [behavioralFinding],
      },
      lensById,
    );

    const route = report.routes[0]!;
    expect(route.evaluated).toEqual({ page: false, behavioral: true });
    expect(route.error).toContain("page: evaluate_page did NOT RUN");
    expect(route.findings).toHaveLength(1);
    expect(route.findings[0]!.lens).toBe(BUTTON_DECISION_LENS.id);
    // An unmeasured lens is at least `concerns`; the important finding agrees.
    expect(route.verdict).toBe("concerns");
  });

  it("still runs the page lens when the behavioral lens throws", async () => {
    const report = await runSurvey(
      plan,
      {
        page: async () => [],
        behavioral: async () => {
          throw new Error("coworker unreachable");
        },
      },
      lensById,
    );

    const route = report.routes[0]!;
    expect(route.evaluated).toEqual({ page: true, behavioral: false });
    expect(route.error).toContain("coworker-button-decision: coworker unreachable");
    expect(route.verdict).toBe("concerns");
  });

  it("reports both lens errors when both fail", async () => {
    const report = await runSurvey(
      plan,
      {
        page: async () => {
          throw new Error("page down");
        },
        behavioral: async () => {
          throw new Error("coworker down");
        },
      },
      lensById,
    );

    expect(report.routes[0]!.error).toBe(
      "page: page down; coworker-button-decision: coworker down",
    );
    expect(report.evaluatedRouteCount).toBe(0);
  });

  it("keeps a critical finding's fail verdict even when a lens errored", async () => {
    const report = await runSurvey(
      plan,
      {
        page: async () => [
          {
            severity: "critical",
            category: "contrast",
            element: "button",
            issue: "unreadable",
            recommendation: "fix",
          },
        ],
        behavioral: async () => {
          throw new Error("coworker down");
        },
      },
      lensById,
    );

    expect(report.routes[0]!.verdict).toBe("fail");
  });
});
