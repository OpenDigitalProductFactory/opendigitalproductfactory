// Tests for the ScreenManifest substrate (types + registry + lint).
// The vitest suite IS the CI lint — running pnpm test in CI catches
// manifest invariant violations the moment a PR touches the directory.
//
// BI-D9487754 / EP-COWORKER-INTERACTIVITY.

import { beforeEach, describe, expect, it } from "vitest";

import { ALL_MANIFESTS } from "./manifests/index";
import { lintManifest, lintManifests } from "./screen-manifest-lint";
import {
  _resetRegistry,
  getActiveManifest,
  listActiveManifests,
  registerManifest,
  unregisterManifest,
} from "./screen-manifest-registry";
import type { ScreenManifest } from "./screen-manifest-types";

// Build a minimal valid manifest, allow per-test overrides.
function makeManifest(overrides: Partial<ScreenManifest> = {}): ScreenManifest {
  return {
    surfaceId: "test-surface",
    routePattern: "/test",
    label: "Test surface",
    selections: [],
    navigations: [],
    panels: [],
    forms: [],
    domainActions: [],
    destructiveActions: [],
    ...overrides,
  };
}

// ─── lint — per-manifest invariants ─────────────────────────────────────────

describe("lintManifest", () => {
  it("passes a minimal valid manifest", () => {
    expect(lintManifest(makeManifest())).toEqual([]);
  });

  it("MANIFEST-001 — flags a domain action referencing an unknown tool", () => {
    const m = makeManifest({
      domainActions: [
        {
          actionId: "go",
          tool: "definitely_not_a_real_tool",
          label: "Go",
          invoke: async () => {},
        },
      ],
    });
    const violations = lintManifest(m);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe("MANIFEST-001");
    expect(violations[0]?.message).toMatch(/definitely_not_a_real_tool/);
  });

  it("MANIFEST-001 — accepts a domain action referencing a real tool", () => {
    const m = makeManifest({
      domainActions: [
        {
          actionId: "go",
          tool: "create_backlog_item",
          label: "Go",
          invoke: async () => {},
        },
      ],
    });
    expect(lintManifest(m)).toEqual([]);
  });

  it("MANIFEST-002 — flags destructiveActions not present in domainActions", () => {
    const m = makeManifest({
      destructiveActions: ["ghost-action"],
    });
    const violations = lintManifest(m);
    expect(violations.find((v) => v.code === "MANIFEST-002")).toBeDefined();
  });

  it("MANIFEST-003 — flags form submit referencing an unknown tool", () => {
    const m = makeManifest({
      forms: [
        {
          formId: "f1",
          label: "F",
          fields: [],
          submit: { tool: "not_a_tool", argMap: {} },
          destructive: false,
        },
      ],
    });
    const violations = lintManifest(m);
    expect(violations.find((v) => v.code === "MANIFEST-003")).toBeDefined();
  });

  it("MANIFEST-004 — flags duplicate selectionId within a manifest", () => {
    const m = makeManifest({
      selections: [
        {
          selectionId: "x",
          label: "A",
          entityType: "T",
          listSource: async () => [],
          applySelection: () => {},
        },
        {
          selectionId: "x",
          label: "B",
          entityType: "T",
          listSource: async () => [],
          applySelection: () => {},
        },
      ],
    });
    const violations = lintManifest(m);
    expect(violations.find((v) => v.code === "MANIFEST-004")).toBeDefined();
  });

  it("MANIFEST-005..008 — uniqueness for panels, forms, navigations, domainActions", () => {
    const dup = makeManifest({
      panels: [
        { panelId: "p", label: "P1", describeOpenState: () => false, open: () => {}, close: () => {} },
        { panelId: "p", label: "P2", describeOpenState: () => false, open: () => {}, close: () => {} },
      ],
      forms: [
        { formId: "f", label: "F1", fields: [], submit: { tool: "create_backlog_item", argMap: {} }, destructive: false },
        { formId: "f", label: "F2", fields: [], submit: { tool: "create_backlog_item", argMap: {} }, destructive: false },
      ],
      navigations: [
        { navigationId: "n", label: "N1", route: "/a", apply: () => {} },
        { navigationId: "n", label: "N2", route: "/b", apply: () => {} },
      ],
      domainActions: [
        { actionId: "a", tool: "create_backlog_item", label: "A1", invoke: async () => {} },
        { actionId: "a", tool: "create_backlog_item", label: "A2", invoke: async () => {} },
      ],
    });
    const violations = lintManifest(dup);
    const codes = new Set(violations.map((v) => v.code));
    expect(codes.has("MANIFEST-005")).toBe(true);
    expect(codes.has("MANIFEST-006")).toBe(true);
    expect(codes.has("MANIFEST-007")).toBe(true);
    expect(codes.has("MANIFEST-008")).toBe(true);
  });

  it("MANIFEST-009 — flags a selection missing applySelection function", () => {
    const m = makeManifest({
      selections: [
        {
          selectionId: "x",
          label: "A",
          entityType: "T",
          listSource: async () => [],
          // Simulate a manifest author wiring up a stub. typeof check
          // catches both undefined and non-function values.
          applySelection: undefined as unknown as (id: string) => void,
        },
      ],
    });
    const violations = lintManifest(m);
    expect(violations.find((v) => v.code === "MANIFEST-009")).toBeDefined();
  });

  it("MANIFEST-010..013 — handler-presence invariants on navigation/panel/field/action", () => {
    const broken = makeManifest({
      navigations: [
        {
          navigationId: "n",
          label: "N",
          route: "/x",
          apply: null as unknown as () => void,
        },
      ],
      panels: [
        {
          panelId: "p",
          label: "P",
          describeOpenState: () => false,
          open: null as unknown as () => void,
          close: () => {},
        },
      ],
      forms: [
        {
          formId: "f",
          label: "F",
          fields: [
            {
              fieldId: "fi",
              label: "FI",
              type: "text",
              required: false,
              setValue: undefined as unknown as (v: unknown) => void,
            },
          ],
          submit: { tool: "create_backlog_item", argMap: {} },
          destructive: false,
        },
      ],
      domainActions: [
        {
          actionId: "a",
          tool: "create_backlog_item",
          label: "A",
          invoke: "not-a-function" as unknown as () => Promise<void>,
        },
      ],
    });
    const violations = lintManifest(broken);
    const codes = new Set(violations.map((v) => v.code));
    expect(codes.has("MANIFEST-010")).toBe(true);
    expect(codes.has("MANIFEST-011")).toBe(true);
    expect(codes.has("MANIFEST-012")).toBe(true);
    expect(codes.has("MANIFEST-013")).toBe(true);
  });
});

// ─── lint — cross-manifest invariants + ALL_MANIFESTS smoke ─────────────────

describe("lintManifests", () => {
  it("MANIFEST-000 — flags duplicate surfaceId across manifests", () => {
    const a = makeManifest({ surfaceId: "dup" });
    const b = makeManifest({ surfaceId: "dup", routePattern: "/other" });
    const violations = lintManifests([a, b]);
    expect(violations[0]?.code).toBe("MANIFEST-000");
  });

  it("ALL_MANIFESTS passes lint (currently empty by design — first consumer lands in BI-6C9CC0EC)", () => {
    expect(lintManifests(ALL_MANIFESTS)).toEqual([]);
  });
});

// ─── runtime registry ───────────────────────────────────────────────────────

describe("ScreenManifest registry", () => {
  beforeEach(() => {
    _resetRegistry();
  });

  it("registers a manifest and exposes via getActiveManifest", () => {
    const m = makeManifest({ surfaceId: "s1", routePattern: "/foo" });
    registerManifest(m);
    expect(getActiveManifest("/foo")).toBe(m);
  });

  it("returns undefined when no manifest matches the route", () => {
    expect(getActiveManifest("/nowhere")).toBeUndefined();
  });

  it("matches routes with :param placeholders", () => {
    const m = makeManifest({ surfaceId: "s2", routePattern: "/build/:buildId" });
    registerManifest(m);
    expect(getActiveManifest("/build/FB-X")).toBe(m);
    expect(getActiveManifest("/build")).toBeUndefined();
    expect(getActiveManifest("/build/FB-X/extra")).toBeUndefined();
  });

  it("tolerates trailing slashes", () => {
    const m = makeManifest({ surfaceId: "s3", routePattern: "/foo" });
    registerManifest(m);
    expect(getActiveManifest("/foo/")).toBe(m);
  });

  it("rejects an empty :param segment", () => {
    const m = makeManifest({ surfaceId: "s4", routePattern: "/x/:id" });
    registerManifest(m);
    expect(getActiveManifest("/x/")).toBeUndefined();
  });

  it("unregisterManifest removes from the registry", () => {
    const m = makeManifest({ surfaceId: "s5" });
    registerManifest(m);
    unregisterManifest("s5");
    expect(listActiveManifests()).toEqual([]);
  });

  it("re-registering the same surfaceId replaces the prior manifest (idempotent registration)", () => {
    const a = makeManifest({ surfaceId: "s6", label: "First" });
    const b = makeManifest({ surfaceId: "s6", label: "Second" });
    registerManifest(a);
    registerManifest(b);
    expect(listActiveManifests()).toHaveLength(1);
    expect(listActiveManifests()[0]?.label).toBe("Second");
  });

  it("publishes the current manifest set to globalThis.__dpf_screen_registry__", () => {
    const m = makeManifest({ surfaceId: "s7" });
    registerManifest(m);
    const g = globalThis as typeof globalThis & {
      __dpf_screen_registry__?: { manifests: ScreenManifest[] };
    };
    expect(g.__dpf_screen_registry__).toBeDefined();
    expect(g.__dpf_screen_registry__?.manifests).toContain(m);
  });

  it("_resetRegistry clears the published snapshot too", () => {
    registerManifest(makeManifest({ surfaceId: "s8" }));
    _resetRegistry();
    const g = globalThis as typeof globalThis & {
      __dpf_screen_registry__?: { manifests: ScreenManifest[] };
    };
    expect(g.__dpf_screen_registry__?.manifests ?? []).toEqual([]);
  });
});
