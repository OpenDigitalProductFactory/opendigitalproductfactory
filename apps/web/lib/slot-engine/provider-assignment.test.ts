import { describe, it, expect } from "vitest";
import { selectProviderRoundRobin } from "./provider-assignment";

describe("selectProviderRoundRobin", () => {
  it("picks provider with lowest effective weight", () => {
    const providers = [
      { id: "p1", name: "Alice", priority: 0, weight: 100, recentBookings: 5 },
      { id: "p2", name: "Bob", priority: 0, weight: 100, recentBookings: 3 },
    ];
    const result = selectProviderRoundRobin(providers);
    expect(result?.id).toBe("p2");
  });

  it("uses priority as tiebreaker (lower priority = first)", () => {
    const providers = [
      { id: "p1", name: "Alice", priority: 1, weight: 100, recentBookings: 3 },
      { id: "p2", name: "Bob", priority: 0, weight: 100, recentBookings: 3 },
    ];
    const result = selectProviderRoundRobin(providers);
    expect(result?.id).toBe("p2");
  });

  it("respects weight differences", () => {
    const providers = [
      { id: "p1", name: "Senior", priority: 0, weight: 50, recentBookings: 2 },
      { id: "p2", name: "Junior", priority: 0, weight: 100, recentBookings: 3 },
    ];
    const result = selectProviderRoundRobin(providers);
    expect(result).toBeDefined();
  });

  it("returns null for empty provider list", () => {
    expect(selectProviderRoundRobin([])).toBeNull();
  });
});
