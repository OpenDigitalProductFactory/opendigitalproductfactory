import { describe, expect, it } from "vitest";

import {
  aggregatePlatformHealth,
  fromJobHealth,
  fromProbe,
  isPlatformHealthy,
  type HealthComponent,
} from "./platform-health";

describe("platform-health normalizers (EP-8DC217EB BET-10)", () => {
  it("fromJobHealth maps ok→healthy, error→down, never→unknown", () => {
    expect(fromJobHealth("ok")).toBe("healthy");
    expect(fromJobHealth("error")).toBe("down");
    expect(fromJobHealth("never")).toBe("unknown");
  });

  it("fromProbe maps reachability to healthy/down", () => {
    expect(fromProbe(true)).toBe("healthy");
    expect(fromProbe(false)).toBe("down");
  });
});

describe("aggregatePlatformHealth (EP-8DC217EB BET-10)", () => {
  const comps = (statuses: HealthComponent["status"][]): HealthComponent[] =>
    statuses.map((status, i) => ({ name: `c${i}`, status }));

  it("is healthy only when every component is healthy", () => {
    const result = aggregatePlatformHealth(comps(["healthy", "healthy"]));
    expect(result.status).toBe("healthy");
    expect(result.healthy).toBe(true);
    expect(result.counts).toEqual({ healthy: 2, degraded: 0, down: 0, unknown: 0 });
  });

  it("is worst-status-wins: a single down dominates", () => {
    const result = aggregatePlatformHealth(comps(["healthy", "degraded", "down"]));
    expect(result.status).toBe("down");
    expect(result.healthy).toBe(false);
  });

  it("degraded beats unknown beats healthy", () => {
    expect(aggregatePlatformHealth(comps(["healthy", "unknown"])).status).toBe("unknown");
    expect(aggregatePlatformHealth(comps(["unknown", "degraded"])).status).toBe("degraded");
  });

  it("an empty component set is unknown (nothing observed)", () => {
    const result = aggregatePlatformHealth([]);
    expect(result.status).toBe("unknown");
    expect(result.healthy).toBe(false);
  });

  it("isPlatformHealthy is the boolean convenience", () => {
    expect(isPlatformHealthy(comps(["healthy"]))).toBe(true);
    expect(isPlatformHealthy(comps(["healthy", "down"]))).toBe(false);
    expect(isPlatformHealthy([])).toBe(false);
  });
});
