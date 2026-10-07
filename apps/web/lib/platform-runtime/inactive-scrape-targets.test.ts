import { describe, expect, it } from "vitest";

import {
  inactiveCapabilityServices,
  isInactiveCapabilityTarget,
  scrapeTargetService,
} from "./inactive-scrape-targets";
import type { CapabilityServiceHealthProjection } from "./service-health";

const projection: CapabilityServiceHealthProjection = {
  aggregate: { value: "Operational", tone: "success", detail: "Required platform services are available" },
  items: [
    {
      key: "adp",
      kind: "service",
      state: "optional_inactive",
      availability: "inactive",
      label: "Optional — inactive",
      action: "Enable its runtime capability when this service is needed.",
      tone: "neutral",
      healthSemantics: "compose-healthcheck",
    },
    {
      key: "portal",
      kind: "service",
      state: "required",
      availability: "available",
      label: "Required — operational",
      action: "No action required.",
      tone: "success",
      healthSemantics: "http",
    },
  ],
};

describe("inactiveCapabilityServices", () => {
  it("collects only services whose capability is inactive", () => {
    expect([...inactiveCapabilityServices(projection)]).toEqual(["adp"]);
  });

  it("is empty when the capability authority is unavailable", () => {
    expect(inactiveCapabilityServices(null).size).toBe(0);
  });
});

describe("scrapeTargetService", () => {
  it("reads the compose service from the target instance host", () => {
    expect(scrapeTargetService({ instance: "adp:8600" })).toBe("adp");
    expect(scrapeTargetService({ instance: "postgres-exporter:9187" })).toBe("postgres-exporter");
    expect(scrapeTargetService({ instance: "portal" })).toBe("portal");
  });

  it("returns null without an instance label", () => {
    expect(scrapeTargetService({ job: "adp" })).toBeNull();
    expect(scrapeTargetService({ instance: "" })).toBeNull();
  });
});

describe("isInactiveCapabilityTarget", () => {
  const inactive = inactiveCapabilityServices(projection);

  it("matches a target whose service belongs to an inactive capability", () => {
    expect(isInactiveCapabilityTarget({ job: "adp", instance: "adp:8600" }, inactive)).toBe(true);
  });

  it("does not match active services, unlabelled targets, or the job name alone", () => {
    expect(isInactiveCapabilityTarget({ job: "portal", instance: "portal:3000" }, inactive)).toBe(false);
    expect(isInactiveCapabilityTarget({ job: "adp" }, inactive)).toBe(false);
  });
});
