// apps/web/components/build/build-studio-layout.test.ts
//
// Layout helper is a foundation utility — these tests pin its public surface
// (test IDs + width tokens + DPF-variable usage) so downstream component
// tests can assert against a stable contract.

import { describe, expect, it } from "vitest";
import {
  ACTION_BANNER_HEIGHT_CLASS,
  BUILD_STUDIO_TEST_IDS,
  DETAILS_DRAWER_WIDTH_CLASS,
  FLEET_ROW_HEIGHT_CLASS,
  FLEET_WIDTH_CLASS,
  WORKFLOW_CANVAS_MIN_HEIGHT_CLASS,
  getActiveZoneClassName,
  getBuildStudioFooterClassName,
  getBuildStudioGraphPanelClassName,
  getBuildStudioShellClassName,
  getBuildStudioSidebarClassName,
  getBuildStudioZoneRowClassName,
  getBuildStudioZoneShellClassName,
  getCoworkerZoneClassName,
  getDetailsDrawerClassName,
  getDetailsDrawerPillClassName,
  getFleetRailBodyClassName,
  getFleetRailClassName,
  getFleetRailHeaderClassName,
  getNodeInspectorClassName,
  getWorkflowCanvasClassName,
  shouldOpenBuildStudioSidebarByDefault,
} from "./build-studio-layout";

describe("BUILD_STUDIO_TEST_IDS", () => {
  it("includes the zone IDs the new layout depends on", () => {
    expect(BUILD_STUDIO_TEST_IDS).toMatchObject({
      shell: expect.any(String),
      fleet: expect.any(String),
      fleetHeader: expect.any(String),
      active: expect.any(String),
      actionBanner: expect.any(String),
      coworker: expect.any(String),
      footer: expect.any(String),
      openSandbox: expect.any(String),
      workflowCanvas: expect.any(String),
      nodeInspector: expect.any(String),
      detailsDrawer: expect.any(String),
      detailsDrawerPill: expect.any(String),
      buildListItem: expect.any(String),
      phaseMiniRail: expect.any(String),
      queueStateBadge: expect.any(String),
    });
  });

  it("uses unique values across all IDs", () => {
    const values = Object.values(BUILD_STUDIO_TEST_IDS);
    expect(new Set(values).size).toBe(values.length);
  });

  it("preserves the legacy graphPanel ID for back-compat", () => {
    // Existing tests use graphPanel; renaming would break them.
    expect(BUILD_STUDIO_TEST_IDS.graphPanel).toBe("build-studio-graph-panel");
  });
});

describe("width and density tokens", () => {
  it("uses Tailwind classes (no inline pixel values)", () => {
    expect(FLEET_WIDTH_CLASS).toMatch(/^w-/);
    expect(FLEET_ROW_HEIGHT_CLASS).toMatch(/(min-)?h-/);
    expect(ACTION_BANNER_HEIGHT_CLASS).toMatch(/^h-/);
    expect(WORKFLOW_CANVAS_MIN_HEIGHT_CLASS).toMatch(/min-h-/);
    expect(DETAILS_DRAWER_WIDTH_CLASS).toMatch(/^w-/);
  });

  it("caps fleet row height at 32px (Tailwind h-8)", () => {
    expect(FLEET_ROW_HEIGHT_CLASS).toContain("max-h-8");
    expect(FLEET_ROW_HEIGHT_CLASS).toContain("min-h-8");
  });

  it("sets ActionBanner height to 40px (Tailwind h-10)", () => {
    expect(ACTION_BANNER_HEIGHT_CLASS).toBe("h-10");
  });

  it("fleet rail width is 150-180px range", () => {
    expect(FLEET_WIDTH_CLASS).toContain("w-[150px]");
    expect(FLEET_WIDTH_CLASS).toContain("xl:w-[180px]");
  });
});

describe("zone class names — DPF-variable invariant", () => {
  // The chief-architect review made DPF CSS variables non-negotiable.
  // Any new layout class string must reference var(--dpf-*) for theme tokens
  // (background, border, text, surface, accent) and must not embed hex literals.

  const NEW_LAYOUT_GETTERS: Array<[string, string]> = [
    ["zone shell", getBuildStudioZoneShellClassName()],
    ["zone row", getBuildStudioZoneRowClassName()],
    ["fleet rail", getFleetRailClassName()],
    ["fleet rail header", getFleetRailHeaderClassName()],
    ["fleet rail body", getFleetRailBodyClassName()],
    ["active zone", getActiveZoneClassName()],
    ["coworker zone", getCoworkerZoneClassName()],
    ["footer", getBuildStudioFooterClassName()],
    ["workflow canvas", getWorkflowCanvasClassName()],
    ["details drawer (open)", getDetailsDrawerClassName(true)],
    ["details drawer (closed)", getDetailsDrawerClassName(false)],
    ["details drawer pill", getDetailsDrawerPillClassName()],
    ["node inspector", getNodeInspectorClassName()],
  ];

  it.each(NEW_LAYOUT_GETTERS)("has no hex literals in %s", (_label, className) => {
    // 3-digit and 6-digit hex literals: #abc / #aabbcc / #abcdef
    expect(className).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });

  it.each(NEW_LAYOUT_GETTERS)("uses DPF CSS variables for any inline color in %s", (_label, className) => {
    // If the class string mentions any of bg-[/text-[/border-[ then those
    // bracketed values should be DPF variables (var(--dpf-*)) — not raw hex.
    const inlineColorMatches = className.match(/(?:bg|text|border|outline|shadow)-\[[^\]]+\]/g) ?? [];
    for (const m of inlineColorMatches) {
      const isDpfVar = m.includes("var(--dpf-");
      // Width/height brackets like w-[150px] are not color tokens — skip those.
      const isSizeOnly = /^w-\[|^h-\[|^min-h-\[/.test(m);
      if (!isSizeOnly) {
        expect(isDpfVar, `${m} must reference a DPF variable`).toBe(true);
      }
    }
  });

  it("zone shell uses grid with the row + footer split", () => {
    expect(getBuildStudioZoneShellClassName()).toContain("grid");
    expect(getBuildStudioZoneShellClassName()).toContain("grid-rows-[1fr_auto]");
  });

  it("workflow canvas reserves min-h for interaction", () => {
    expect(getWorkflowCanvasClassName()).toContain(WORKFLOW_CANVAS_MIN_HEIGHT_CLASS);
  });

  it("drawer transitions are gated by motion-reduce", () => {
    expect(getDetailsDrawerClassName(true)).toContain("motion-reduce:transition-none");
  });

  it("drawer translates fully off-canvas when closed", () => {
    expect(getDetailsDrawerClassName(false)).toContain("translate-x-full");
    expect(getDetailsDrawerClassName(true)).toContain("translate-x-0");
  });
});

describe("legacy helpers — preserved for back-compat", () => {
  it("getBuildStudioShellClassName is still callable and uses DPF variables", () => {
    const cn = getBuildStudioShellClassName();
    expect(cn).toContain("border-[var(--dpf-border)]");
    expect(cn).toContain("bg-[var(--dpf-surface-1)]");
  });

  it("getBuildStudioSidebarClassName toggles width and border on open/closed", () => {
    expect(getBuildStudioSidebarClassName(true)).toContain("w-[280px]");
    expect(getBuildStudioSidebarClassName(false)).toContain("w-0");
    expect(getBuildStudioSidebarClassName(false)).toContain("border-r-0");
  });

  it("shouldOpenBuildStudioSidebarByDefault opens at >=1024px", () => {
    expect(shouldOpenBuildStudioSidebarByDefault(1280)).toBe(true);
    expect(shouldOpenBuildStudioSidebarByDefault(1024)).toBe(true);
    expect(shouldOpenBuildStudioSidebarByDefault(1023)).toBe(false);
    expect(shouldOpenBuildStudioSidebarByDefault(undefined)).toBe(true);
  });

  it("getBuildStudioGraphPanelClassName preserves the legacy graph panel class", () => {
    expect(getBuildStudioGraphPanelClassName()).toContain("min-h-[420px]");
  });
});
