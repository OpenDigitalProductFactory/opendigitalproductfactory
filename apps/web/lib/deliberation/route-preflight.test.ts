import { describe, it, expect, vi } from "vitest";
import { preflightDeliberationRoute } from "./route-preflight";

// BI-8C44DB49 slice 2. On the live install ~8 builds re-dispatched a
// deliberation ~100 times each against a capability floor no endpoint could
// satisfy, producing 5,026 stalled TaskRuns and holding the self-upgrade
// quiescence gate open. The run that is never created is the one that cannot do
// that.

const capabilityFloorError = () =>
  Object.assign(
    new Error(
      "No eligible endpoints for task 'conversation': No endpoint satisfies agent capability floor (EP-AGENT-CAP-002). Missing: toolUse. (3 endpoint(s) excluded)",
    ),
    { name: "NoEligibleEndpointsError", missingCapability: "toolUse" },
  );

const probes = [
  { roleId: "critic", minimumCapabilities: { toolUse: true } },
  { roleId: "advocate", minimumCapabilities: { toolUse: true } },
];

describe("blocks only what provably cannot run", () => {
  it("blocks when every role fails the capability floor", async () => {
    const preview = vi.fn().mockRejectedValue(capabilityFloorError());
    const result = await preflightDeliberationRoute(probes, { previewRouteImpl: preview as never });

    expect(result.blocked).toBe(true);
    expect(result.verdict?.code).toBe("capability-floor-unmet");
    expect(result.verdict?.missingCapability).toBe("toolUse");
    expect(preview).toHaveBeenCalledTimes(2);
  });

  it("passes the role's real capability floor to the router", async () => {
    const preview = vi.fn().mockResolvedValue({ decision: {}, selectedManifest: {}, contract: {} });
    await preflightDeliberationRoute(probes, { previewRouteImpl: preview as never });

    // The live failure only throws when minimumCapabilities is set. A probe
    // without it evaluates no floor at all and is meaningless. Tools are NOT the
    // gate here — buildBranchRequestContract sets requiresTools:false, and
    // routing relaxes an unsatisfiable tools requirement anyway.
    const [, , options] = preview.mock.calls[0];
    expect(options.minimumCapabilities).toEqual({ toolUse: true });
    expect(options.tools).toBeUndefined();
  });

  it("proceeds as soon as ONE role can route — a deliberation may run fewer branches", async () => {
    const preview = vi
      .fn()
      .mockRejectedValueOnce(capabilityFloorError())
      .mockResolvedValueOnce({ decision: {}, selectedManifest: {}, contract: {} });
    const result = await preflightDeliberationRoute(probes, { previewRouteImpl: preview as never });

    expect(result.blocked).toBe(false);
  });
});

describe("fails safe — a false block is worse than the flood", () => {
  it("proceeds on a transient routing failure", async () => {
    const preview = vi.fn().mockRejectedValue(new Error("HTTP 429 rate_limit_exceeded"));
    const result = await preflightDeliberationRoute(probes, { previewRouteImpl: preview as never });

    expect(result.blocked).toBe(false);
  });

  it("proceeds on an unrecognised failure rather than abandoning recoverable work", async () => {
    const preview = vi.fn().mockRejectedValue(new Error("something nobody has seen"));
    const result = await preflightDeliberationRoute(probes, { previewRouteImpl: preview as never });

    expect(result.blocked).toBe(false);
  });

  it("proceeds when there is nothing to probe", async () => {
    const preview = vi.fn();
    const result = await preflightDeliberationRoute([], { previewRouteImpl: preview as never });

    expect(result.blocked).toBe(false);
    expect(preview).not.toHaveBeenCalled();
  });
});
