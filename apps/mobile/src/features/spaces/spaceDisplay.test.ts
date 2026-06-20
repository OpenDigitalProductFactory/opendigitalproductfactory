import { orderSpacesForSwitcher } from "./spaceDisplay";
import type { Space } from "@dpf/types";

function s(spaceId: string, lastUsedAt?: number): Space {
  return {
    spaceId,
    url: `https://${spaceId}.example`,
    label: spaceId,
    descriptor: {
      instanceId: spaceId,
      orgName: spaceId,
      apiVersion: "v1",
      authModes: ["password"],
    },
    lastUsedAt,
  };
}

describe("orderSpacesForSwitcher", () => {
  it("places the active space first, then by lastUsedAt desc", () => {
    const result = orderSpacesForSwitcher({
      spaces: [s("a", 100), s("b", 300), s("c", 200)],
      activeSpaceId: "c",
    });
    expect(result.map((r) => r.spaceId)).toEqual(["c", "b", "a"]);
  });

  it("flags exactly one row as active when an id matches; none when null", () => {
    const r1 = orderSpacesForSwitcher({
      spaces: [s("a", 100), s("b", 200)],
      activeSpaceId: "b",
    });
    expect(r1.filter((r) => r.isActive).map((r) => r.spaceId)).toEqual(["b"]);

    const r2 = orderSpacesForSwitcher({
      spaces: [s("a", 100), s("b", 200)],
      activeSpaceId: null,
    });
    expect(r2.filter((r) => r.isActive)).toEqual([]);
  });

  it("falls back to insertion order on a lastUsedAt tie (stable)", () => {
    const result = orderSpacesForSwitcher({
      spaces: [s("first"), s("second")],
      activeSpaceId: null,
    });
    expect(result.map((r) => r.spaceId)).toEqual(["first", "second"]);
  });

  it("an unknown activeSpaceId still orders by lastUsedAt, no row flagged active", () => {
    const result = orderSpacesForSwitcher({
      spaces: [s("a", 100), s("b", 300)],
      activeSpaceId: "ghost",
    });
    expect(result.map((r) => r.spaceId)).toEqual(["b", "a"]);
    expect(result.every((r) => !r.isActive)).toBe(true);
  });
});
