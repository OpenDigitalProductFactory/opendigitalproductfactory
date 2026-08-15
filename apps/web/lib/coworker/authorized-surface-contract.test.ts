import { describe, expect, it } from "vitest";

import type { SurfaceDefinition } from "@dpf/types";

import {
  adaptPageContextProviderToSurface,
  adaptScreenManifestToSurface,
  compileSurfaceDefinitions,
  lintSurfaceDefinitions,
} from "./authorized-surface-compiler";

function definition(overrides: Partial<SurfaceDefinition> = {}): SurfaceDefinition {
  return {
    contractVersion: "1.0",
    surfaceId: "platform.estate-discovery",
    label: "Estate Discovery",
    purpose: "Configure and operate estate discovery without guessing from a route or DOM.",
    supportedModes: ["browser", "headless", "workroom", "external", "mobile"],
    entryPoints: [
      { kind: "route", pattern: "/platform/tools/discovery" },
      { kind: "task-intent", intent: "configure network discovery" },
      { kind: "workroom", workroomType: "platform-operations" },
    ],
    loaderId: "estate-discovery.view-model",
    nodes: [
      {
        nodeId: "discovery-method",
        kind: "field",
        accessibleName: "Discovery Method",
        valuePolicy: "read",
        sensitivity: "internal",
      },
      {
        nodeId: "community-string",
        kind: "field",
        accessibleName: "Community String",
        valuePolicy: "write-only",
        sensitivity: "secret",
      },
    ],
    actions: [
      {
        actionId: "save-and-test",
        label: "Save & Test",
        actionClass: "domain",
        tool: "configure_gateway_scan",
        risk: "medium",
        confirmation: "policy",
      },
    ],
    ...overrides,
  };
}

describe("Authorized Surface Contract compiler", () => {
  it("compiles deterministically and indexes stable identity by route, task intent, and workroom", () => {
    const first = compileSurfaceDefinitions([definition()], {
      toolNames: new Set(["configure_gateway_scan"]),
      loaderIds: new Set(["estate-discovery.view-model"]),
    });
    const second = compileSurfaceDefinitions([definition()], {
      toolNames: new Set(["configure_gateway_scan"]),
      loaderIds: new Set(["estate-discovery.view-model"]),
    });

    expect(first.digest).toBe(second.digest);
    expect(first.resolve({ route: "/platform/tools/discovery" })?.surfaceId).toBe(
      "platform.estate-discovery",
    );
    expect(first.resolve({ taskIntent: "Configure network discovery" })?.surfaceId).toBe(
      "platform.estate-discovery",
    );
    expect(first.resolve({ workroomType: "platform-operations" })?.surfaceId).toBe(
      "platform.estate-discovery",
    );
  });

  it("rejects duplicate IDs, route-shaped identity, unknown kinds, and missing accessible names", () => {
    const broken = definition({
      surfaceId: "/platform/tools/discovery",
      nodes: [
        {
          nodeId: "duplicate",
          kind: "field",
          accessibleName: "",
          valuePolicy: "read",
          sensitivity: "internal",
        },
        {
          nodeId: "duplicate",
          kind: "widget-that-does-not-exist" as "field",
          accessibleName: "Broken",
          valuePolicy: "read",
          sensitivity: "internal",
        },
      ],
    });

    const codes = new Set(lintSurfaceDefinitions([broken], {
      toolNames: new Set(["configure_gateway_scan"]),
      loaderIds: new Set(["estate-discovery.view-model"]),
    }).map((violation) => violation.code));

    expect(codes).toEqual(expect.objectContaining(new Set([
      "ASC-002",
      "ASC-004",
      "ASC-005",
      "ASC-006",
    ])));
  });

  it("rejects unknown loaders/tools and any readable secret or password field", () => {
    const broken = definition({
      loaderId: "missing.loader",
      nodes: [
        {
          nodeId: "credential",
          kind: "field",
          accessibleName: "Credential",
          fieldType: "password",
          valuePolicy: "read",
          sensitivity: "secret",
        },
      ],
      actions: [{
        actionId: "save",
        label: "Save",
        actionClass: "domain",
        tool: "missing_tool",
        risk: "medium",
        confirmation: "policy",
      }],
    });

    const codes = lintSurfaceDefinitions([broken], {
      toolNames: new Set(["configure_gateway_scan"]),
      loaderIds: new Set(["estate-discovery.view-model"]),
    }).map((violation) => violation.code);

    expect(codes).toContain("ASC-007");
    expect(codes).toContain("ASC-008");
    expect(codes).toContain("ASC-009");
  });

  it("adapts legacy PageContext and ScreenManifest metadata without retaining executable callbacks", () => {
    const page = adaptPageContextProviderToSurface({
      route: "/legacy",
      match: "exact",
      label: "Legacy Page",
      loaderId: "legacy.page-context",
      supportedModes: ["browser", "headless"],
    });
    expect(page.entryPoints).toContainEqual({ kind: "route", pattern: "/legacy" });
    expect(page.nodes[0]).toMatchObject({ presentationOnly: true });

    const prefixPage = adaptPageContextProviderToSurface({
      route: "/workspace",
      match: "prefix",
      label: "Legacy Workspace",
      loaderId: "legacy.page-context",
      supportedModes: ["browser", "headless"],
    });
    const prefixCatalog = compileSurfaceDefinitions([prefixPage], {
      toolNames: new Set(),
      loaderIds: new Set(["legacy.page-context"]),
    });
    expect(prefixCatalog.resolve({ route: "/workspace" })?.surfaceId).toBe(prefixPage.surfaceId);
    expect(prefixCatalog.resolve({ route: "/workspace/cases/CASE-1" })?.surfaceId).toBe(prefixPage.surfaceId);

    const screen = adaptScreenManifestToSurface({
      manifest: {
        surfaceId: "legacy.build",
        routePattern: "/build",
        label: "Build",
        selections: [], navigations: [], panels: [],
        forms: [{
          formId: "settings", label: "Settings", destructive: false,
          fields: [{ fieldId: "name", label: "Name", type: "text", required: true, setValue: () => undefined }],
          submit: { tool: "save_settings", argMap: { name: "name" } },
        }],
        domainActions: [{ actionId: "publish", tool: "publish_build", label: "Publish", invoke: async () => undefined }],
        destructiveActions: ["publish"],
      },
      loaderId: "legacy.screen",
      supportedModes: ["browser"],
    });
    expect(screen.actions.map((action) => action.tool)).toEqual(["save_settings", "publish_build"]);
    expect(JSON.stringify(screen)).not.toMatch(/setValue|invoke/);
  });
});
