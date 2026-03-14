import { describe, expect, it } from "vitest";
import {
  getRouteSensitivity,
  isProviderAllowedForSensitivity,
  filterProviderPriorityBySensitivity,
  type RouteSensitivity,
} from "./agent-sensitivity";

describe("getRouteSensitivity", () => {
  it("returns restricted for admin routes", () => {
    expect(getRouteSensitivity("/admin")).toBe("restricted");
  });

  it("returns confidential for employee routes", () => {
    expect(getRouteSensitivity("/employee")).toBe("confidential");
  });

  it("returns internal for operations routes", () => {
    expect(getRouteSensitivity("/ops")).toBe("internal");
  });

  it("falls back to internal for unknown routes", () => {
    expect(getRouteSensitivity("/unknown")).toBe("internal");
  });
});

describe("isProviderAllowedForSensitivity", () => {
  it("allows any provider for public routes", () => {
    expect(
      isProviderAllowedForSensitivity("public", { providerId: "openai", costModel: "token", category: "direct" }),
    ).toBe(true);
  });

  it("prefers but does not block cloud providers for internal routes", () => {
    expect(
      isProviderAllowedForSensitivity("internal", { providerId: "openai", costModel: "token", category: "direct" }),
    ).toBe(true);
  });

  it("blocks cloud providers for restricted routes", () => {
    expect(
      isProviderAllowedForSensitivity("restricted", { providerId: "openai", costModel: "token", category: "direct" }),
    ).toBe(false);
  });

  it("allows local compute providers for restricted routes", () => {
    expect(
      isProviderAllowedForSensitivity("restricted", { providerId: "ollama", costModel: "compute", category: "direct" }),
    ).toBe(true);
  });
});

describe("filterProviderPriorityBySensitivity", () => {
  const priority = [
    { providerId: "openai", modelId: "gpt-4.1", rank: 1, capabilityTier: "deep-thinker" },
    { providerId: "ollama", modelId: "llama3.1", rank: 2, capabilityTier: "fast-worker" },
  ];

  const providers = [
    { providerId: "openai", costModel: "token", category: "direct" },
    { providerId: "ollama", costModel: "compute", category: "direct" },
  ];

  it("keeps both providers for internal routes", () => {
    expect(filterProviderPriorityBySensitivity(priority, providers, "internal").map((p) => p.providerId)).toEqual([
      "openai",
      "ollama",
    ]);
  });

  it("keeps only local providers for restricted routes", () => {
    expect(filterProviderPriorityBySensitivity(priority, providers, "restricted").map((p) => p.providerId)).toEqual([
      "ollama",
    ]);
  });

  it("returns an empty list when no provider qualifies", () => {
    expect(
      filterProviderPriorityBySensitivity(priority, [{ providerId: "openai", costModel: "token", category: "direct" }], "restricted"),
    ).toEqual([]);
  });
});

describe("route sensitivity coverage", () => {
  it("uses only supported sensitivity levels", () => {
    const levels: RouteSensitivity[] = ["public", "internal", "confidential", "restricted"];
    expect(levels).toHaveLength(4);
  });
});
