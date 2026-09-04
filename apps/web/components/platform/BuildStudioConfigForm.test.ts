import { describe, expect, it } from "vitest";
import {
  describeBuildEngineSelection,
  shouldShowPinnedEngineMissingWarning,
} from "@/components/platform/build-studio-config-form-model";
import { BUILD_STUDIO_CONFIG_ROUTE_COPY } from "@/components/platform/build-studio-route-copy";

describe("Build Studio runtime route copy", () => {
  it("exposes configuration-oriented copy and a return path to the working studio", () => {
    expect(BUILD_STUDIO_CONFIG_ROUTE_COPY.title).toBe("Build Studio Runtime");
    expect(BUILD_STUDIO_CONFIG_ROUTE_COPY.description).toContain("configure how builds run");
    expect(BUILD_STUDIO_CONFIG_ROUTE_COPY.openStudioLabel).toBe("Open Build Studio");
    expect(BUILD_STUDIO_CONFIG_ROUTE_COPY.openStudioHref).toBe("/build");
  });
});

describe("Build Studio engine readiness projection", () => {
  it("projects variable router diagnostics into stable owner-facing readiness", () => {
    expect(describeBuildEngineSelection({
      status: "selected",
      policy: { mode: "auto", pinnedEngine: null },
      selected: null,
      reason: "No eligible endpoints for task type 'code-gen' with sensitivity 'development'. 0 endpoint(s) excluded.",
      rejected: [],
      fallbackChain: [],
      fallbackDisabled: false,
      action: null,
    })).toBe("Ready under current routing and policy.");

    expect(describeBuildEngineSelection({
      status: "blocked",
      policy: { mode: "auto", pinnedEngine: null },
      selected: null,
      reason: "Internal routing diagnostic with provider identifiers.",
      rejected: [],
      fallbackChain: [],
      fallbackDisabled: false,
      action: "Connect a provider.",
    })).toBe("No engine currently meets readiness and policy.");
  });

  it("does not describe a legacy engine choice as selected while Auto chose another engine", () => {
    expect(shouldShowPinnedEngineMissingWarning({
      enginePolicy: "auto",
      provider: "opencode",
      probing: false,
      present: false,
    })).toBe(false);
  });

  it("keeps the actionable missing-engine warning for an explicit hard pin", () => {
    expect(shouldShowPinnedEngineMissingWarning({
      enginePolicy: "pinned",
      provider: "opencode",
      probing: false,
      present: false,
    })).toBe(true);
  });
});
