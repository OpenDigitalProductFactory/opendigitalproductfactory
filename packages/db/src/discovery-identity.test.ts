import { describe, expect, it } from "vitest";

import { buildDiscoveredKey, buildInventoryEntityKey } from "./discovery-identity";

describe("buildDiscoveredKey", () => {
  it("creates a stable key for a docker container by runtime id", () => {
    expect(buildDiscoveredKey({
      sourceKind: "dpf_bootstrap",
      itemType: "docker_container",
      externalRef: "container:abc123",
    })).toBe("dpf_bootstrap:docker_container:container:abc123");
  });
});

describe("buildInventoryEntityKey", () => {
  it("normalizes host identity into a stable inventory key", () => {
    expect(buildInventoryEntityKey({
      entityType: "host",
      naturalKey: "hostname:dpf-dev",
    })).toBe("host:hostname:dpf-dev");
  });
});
