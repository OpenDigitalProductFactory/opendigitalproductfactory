import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockBootstrapAuthorityBindings, mockCount } = vi.hoisted(() => ({
  mockBootstrapAuthorityBindings: vi.fn(),
  mockCount: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    authorityBinding: {
      count: mockCount,
    },
  },
}));

vi.mock("./bootstrap-bindings", () => ({
  bootstrapAuthorityBindings: mockBootstrapAuthorityBindings,
}));

import { getAuthorityBindingBootstrapState } from "./bootstrap-rollout";

describe("getAuthorityBindingBootstrapState", () => {
  beforeEach(() => {
    mockCount.mockReset();
    mockBootstrapAuthorityBindings.mockReset();
  });

  it("auto-bootstraps on first load when no bindings exist and no filters are active", async () => {
    mockCount.mockResolvedValue(0);
    mockBootstrapAuthorityBindings.mockResolvedValue({
      created: 3,
      skippedExisting: 0,
      wouldCreate: 0,
      candidates: [],
      lowConfidence: [{ resourceRef: "/setup", agentId: "onboarding-coo", reason: "ungated-route" }],
    });

    const state = await getAuthorityBindingBootstrapState({
      canWrite: true,
      hasActiveFilters: false,
    });

    expect(mockBootstrapAuthorityBindings).toHaveBeenCalledWith({ writeMode: "commit" });
    expect(state.autoApplied).toBe(true);
    expect(state.report?.created).toBe(3);
  });

  it("shows dry-run review state when bindings already exist", async () => {
    mockCount.mockResolvedValue(4);
    mockBootstrapAuthorityBindings.mockResolvedValue({
      created: 0,
      skippedExisting: 4,
      wouldCreate: 0,
      candidates: [],
      lowConfidence: [{ resourceRef: "/setup", agentId: "onboarding-coo", reason: "ungated-route" }],
    });

    const state = await getAuthorityBindingBootstrapState({
      canWrite: true,
      hasActiveFilters: false,
    });

    expect(mockBootstrapAuthorityBindings).toHaveBeenCalledWith({ writeMode: "dry-run" });
    expect(state.autoApplied).toBe(false);
    expect(state.report?.lowConfidence).toHaveLength(1);
  });

  it("stays passive when filters are active or the user cannot write", async () => {
    const state = await getAuthorityBindingBootstrapState({
      canWrite: false,
      hasActiveFilters: true,
    });

    expect(mockCount).not.toHaveBeenCalled();
    expect(mockBootstrapAuthorityBindings).not.toHaveBeenCalled();
    expect(state).toEqual({
      autoApplied: false,
      report: null,
      totalBindings: null,
    });
  });
});
