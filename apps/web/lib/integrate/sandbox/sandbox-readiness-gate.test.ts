import { describe, expect, it } from "vitest";

import {
  assertSandboxReadyForContribution,
  assertSandboxReadyForDeploy,
} from "./sandbox-readiness-gate";
import type { SandboxReadinessSnapshot } from "./sandbox-admin-types";

const healthy: SandboxReadinessSnapshot = {
  buildId: "FB-TEST",
  state: "healthy",
  canDeploy: true,
  canContribute: true,
  summary: "healthy",
  checks: [],
  recommendedActions: [],
  inspectedAt: "2026-05-22T00:00:00.000Z",
};

describe("sandbox readiness gates", () => {
  it("allows deploy for healthy sandbox", () => {
    expect(assertSandboxReadyForDeploy(healthy)).toEqual({ ok: true });
  });

  it("blocks deploy for detached sandbox", () => {
    const result = assertSandboxReadyForDeploy({
      ...healthy,
      state: "detached",
      canDeploy: false,
      summary: "sandbox is detached",
    });

    expect(result).toMatchObject({
      ok: false,
      state: "detached",
      message: expect.stringContaining("deploy_feature"),
    });
  });

  it("blocks contribution when source is stale", () => {
    const result = assertSandboxReadyForContribution({
      ...healthy,
      state: "stale_source",
      canContribute: false,
      summary: "source is stale",
    });

    expect(result).toMatchObject({
      ok: false,
      state: "stale_source",
      message: expect.stringContaining("upstream contribution"),
    });
  });
});
