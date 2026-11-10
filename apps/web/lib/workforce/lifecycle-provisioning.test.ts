import { describe, expect, it } from "vitest";

import {
  LIFECYCLE_CAPABILITIES,
  isDue,
  mayComplete,
  outstandingRevocations,
  resolveProvisioningStep,
  type CapabilityResolver,
  type ProvisioningStep,
} from "./lifecycle-provisioning";

function step(overrides: Partial<ProvisioningStep> = {}): ProvisioningStep {
  return {
    stepKey: "create-account",
    capability: "directory.user.create",
    executeOn: null,
    executedAt: null,
    isRevocation: false,
    ...overrides,
  };
}

const registryServing = (...capabilities: string[]): CapabilityResolver => ({
  getByCapability: (capability) =>
    capabilities.includes(capability) ? { connectorKey: "acme-directory" } : undefined,
});

describe("selection is by capability, never by connector key", () => {
  it("resolves a served capability to whichever connector serves it", () => {
    const resolution = resolveProvisioningStep({
      step: step(),
      classification: "employee",
      jurisdiction: "us",
      registry: registryServing("directory.user.create"),
    });

    expect(resolution).toEqual({ kind: "resolved", connectorKey: "acme-directory" });
  });

  it("names no connector in the step itself", () => {
    // Pinning a vendor in the step would make changing identity provider a
    // rewrite of every step rather than a registry change.
    expect(Object.keys(step())).not.toContain("connectorKey");
    expect(Object.keys(step())).toContain("capability");
  });

  it("uses the SCIM-shaped dotted namespace", () => {
    for (const capability of LIFECYCLE_CAPABILITIES) {
      expect(capability).toMatch(/^[a-z]+(\.[a-z]+)+$/);
    }
  });
});

describe("an unresolved capability is a named gap, not an anonymous failure", () => {
  it("names the capability and offers the three dispositions", () => {
    const resolution = resolveProvisioningStep({
      step: step({ capability: "licence.seat.assign" }),
      classification: "employee",
      jurisdiction: "us",
      registry: registryServing("directory.user.create"),
    });

    expect(resolution).toMatchObject({
      kind: "capability-gap",
      capability: "licence.seat.assign",
      dispositions: ["absorb", "generate-on-demand", "record-as-manual"],
    });
    if (resolution.kind !== "capability-gap") throw new Error("expected gap");
    expect(resolution.message).toContain("licence.seat.assign");
  });

  it("reports a gap for every capability while no connector is on the kernel", () => {
    // The thirteen off-kernel connectors are integration-strategy work outside
    // this epic. Until they migrate, these surface by name rather than failing
    // at execution time.
    const empty = registryServing();
    for (const capability of LIFECYCLE_CAPABILITIES) {
      const resolution = resolveProvisioningStep({
        step: step({ capability }),
        classification: "employee",
        jurisdiction: "us",
        registry: empty,
      });
      expect(resolution.kind).toBe("capability-gap");
    }
  });
});

describe("every step is classification-gated before execution", () => {
  it("refuses to provision a contingent worker as an employee", () => {
    const resolution = resolveProvisioningStep({
      step: step(),
      classification: "contractor_direct",
      jurisdiction: "us",
      registry: registryServing("directory.user.create"),
    });

    expect(resolution.kind).toBe("refused");
  });

  it("refuses before touching the registry at all", () => {
    // Resolving a connector for a step that must not run would do the vendor
    // lookup, credential fetch and audit write for an action the organisation is
    // not entitled to take.
    let consulted = false;
    const spy: CapabilityResolver = {
      getByCapability: (capability) => {
        consulted = true;
        return { connectorKey: capability };
      },
    };

    resolveProvisioningStep({
      step: step(),
      classification: "volunteer",
      jurisdiction: "us",
      registry: spy,
    });

    expect(consulted).toBe(false);
  });

  it("refuses on unresolved classification or jurisdiction", () => {
    for (const overrides of [
      { classification: null, jurisdiction: "us" as const },
      { classification: "employee" as const, jurisdiction: null },
    ]) {
      const resolution = resolveProvisioningStep({
        step: step(),
        registry: registryServing("directory.user.create"),
        ...overrides,
      });
      expect(resolution.kind).toBe("refused");
    }
  });

  it("permits the employee path", () => {
    expect(
      resolveProvisioningStep({
        step: step(),
        classification: "employee",
        jurisdiction: "us",
        registry: registryServing("directory.user.create"),
      }).kind,
    ).toBe("resolved");
  });
});

describe("an instance cannot complete with a revocation outstanding", () => {
  const revocation = step({
    stepKey: "revoke-account",
    capability: "directory.user.suspend",
    isRevocation: true,
  });

  it("blocks completion while a revocation has not executed", () => {
    expect(mayComplete([revocation])).toBe(false);
    expect(outstandingRevocations([revocation])).toHaveLength(1);
  });

  it("still blocks when the revocation is merely SCHEDULED for the future", () => {
    // The room stays accountable until access is actually gone, not until
    // somebody wrote down a date.
    const scheduled = { ...revocation, executeOn: new Date("2099-01-01") };
    expect(mayComplete([scheduled])).toBe(false);
    expect(outstandingRevocations([scheduled])[0].dueOn).toEqual(new Date("2099-01-01"));
  });

  it("allows completion once every revocation has executed", () => {
    const executed = { ...revocation, executedAt: new Date("2026-01-01") };
    expect(mayComplete([executed])).toBe(true);
  });

  it("does not block on a non-revocation step", () => {
    expect(mayComplete([step()])).toBe(true);
  });

  it("reports every outstanding revocation, not just the first", () => {
    const blocks = outstandingRevocations([
      revocation,
      { ...revocation, stepKey: "revoke-licence", capability: "licence.seat.revoke" },
      step(),
    ]);

    expect(blocks.map((b) => b.stepKey)).toEqual(["revoke-account", "revoke-licence"]);
  });
});

describe("dated execution", () => {
  const now = new Date("2026-06-15T00:00:00.000Z");

  it("runs an undated step immediately", () => {
    expect(isDue(step(), now)).toBe(true);
  });

  it("does not run before its date", () => {
    expect(isDue(step({ executeOn: new Date("2026-07-01") }), now)).toBe(false);
  });

  it("runs on and after its date", () => {
    expect(isDue(step({ executeOn: now }), now)).toBe(true);
    expect(isDue(step({ executeOn: new Date("2026-06-01") }), now)).toBe(true);
  });

  it("never re-runs an executed step", () => {
    expect(isDue(step({ executedAt: new Date("2026-06-01") }), now)).toBe(false);
  });
});
