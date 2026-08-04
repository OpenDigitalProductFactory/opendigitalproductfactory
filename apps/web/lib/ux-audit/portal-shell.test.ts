import { describe, expect, it } from "vitest";
import {
  PORTAL_SHELL_LENSES,
  isPortalShellCoworkerRoute,
  portalShellRoutes,
  portalShellTargets,
} from "./portal-shell";
import { PORTAL_SHELL_SECTIONS } from "@/lib/navigation/portal-navigation-model";
import { planSurvey, type RouteManifest } from "./portal-survey";
import rawRouteManifest from "@/lib/ea/route-manifest.json";

// The generated manifest widens `kind` to string; the survey types narrow it.
const routeManifest = rawRouteManifest as unknown as RouteManifest;

describe("portalShellTargets", () => {
  it("resolves one home per shipped shell section, in rail order", () => {
    const targets = portalShellTargets();
    expect(targets.map((t) => t.sectionKey)).toEqual(
      PORTAL_SHELL_SECTIONS.map((s) => s.key),
    );
  });

  it("resolves only concrete, visitable routes", () => {
    for (const target of portalShellTargets()) {
      expect(target.route.startsWith("/")).toBe(true);
      expect(target.route).not.toContain("[");
    }
  });

  it("puts Workspace first — the personal landing page is the shell entry", () => {
    expect(portalShellTargets()[0]).toMatchObject({ sectionKey: "workspace", route: "/workspace" });
  });
});

describe("portal-shell survey targets against the route manifest", () => {
  it("every target is a real page route the survey can plan", () => {
    const pages = new Set(
      routeManifest.routes
        .filter((r) => r.kind === "page" && r.dynamicParams.length === 0)
        .map((r) => r.routePath),
    );
    for (const route of portalShellRoutes()) {
      expect(pages.has(route), `${route} must be a concrete page route`).toBe(true);
    }
  });

  it("plans a page lens on every target and the behavioral lens on coworker routes", () => {
    const targets = portalShellRoutes();
    const plan = planSurvey(routeManifest, {
      lenses: PORTAL_SHELL_LENSES,
      include: (entry) => targets.includes(entry.routePath),
      coworkerRoute: isPortalShellCoworkerRoute,
    });

    expect(plan.entries.map((e) => e.route).sort()).toEqual([...targets].sort());
    for (const entry of plan.entries) {
      expect(entry.lenses).toContain("page-evaluation");
      expect(entry.lenses).toContain("coworker-button-decision");
    }
  });
});

describe("isPortalShellCoworkerRoute", () => {
  it("is true for the shell homes and false elsewhere", () => {
    expect(isPortalShellCoworkerRoute("/workspace")).toBe(true);
    expect(isPortalShellCoworkerRoute("/nope")).toBe(false);
  });
});

describe("PORTAL_SHELL_LENSES", () => {
  it("carries exactly one page lens and the button-decision behavioral lens", () => {
    expect(PORTAL_SHELL_LENSES.filter((l) => l.mode === "page")).toHaveLength(1);
    expect(PORTAL_SHELL_LENSES.filter((l) => l.mode === "behavioral").map((l) => l.id)).toEqual([
      "coworker-button-decision",
    ]);
  });
});
