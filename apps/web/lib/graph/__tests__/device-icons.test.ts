import { describe, expect, it } from "vitest";

import { getDeviceVisual, PHYSICAL_LEGEND_ENTRIES } from "@/lib/graph/device-icons";

describe("physical topology device visuals", () => {
  it("identifies the WAN uplink instead of rendering it as an unknown device", () => {
    expect(getDeviceVisual("wan_uplink").label).toBe("WAN / Internet");
  });

  it("keeps the physical legend limited to the hierarchy shown in that view", () => {
    expect(PHYSICAL_LEGEND_ENTRIES.map((entry) => entry.ciType)).toEqual([
      "wan_uplink",
      "router",
      "switch",
      "access_point",
      "network_client",
    ]);
  });
});
