// apps/web/lib/tak/no-literal-pins.test.ts
//
// BI-8CFA1CA8 — a provider pin written into route source has no "Clear pin"
// button. The operator-facing control (AgentModelRoutingCard) can only clear
// what lives in AgentModelConfig; a literal in ROUTE_AGENT_MAP is unreachable
// from the portal and survives every provider being disabled.
//
// The /build route was fixed once already, citing `no-provider-pinning`, after
// the 2026-05-12 "Pinned provider 'codex' not available" warnings. The cleanup
// stopped at that one route because nothing prevented the next one. This test
// is that prevention.
//
// Kernel: docs/founder-kernel/wiki/principles/no-provider-pinning.md (core).
import { describe, expect, it } from "vitest";
import { ROUTE_AGENT_MAP_ENTRIES } from "./agent-routing";

/** Keys that bind a route to one provider or model instead of to a requirement. */
const PIN_KEYS = [
  "preferredProviderId",
  "preferredModelId",
  "pinnedProviderId",
  "pinnedModelId",
  "pinnedEndpointId",
] as const;

describe("route model requirements carry no literal provider pins", () => {
  it("expresses what a route needs, never which provider serves it", () => {
    const offenders: string[] = [];

    for (const [route, entry] of ROUTE_AGENT_MAP_ENTRIES) {
      const requirements = entry.modelRequirements as
        | Record<string, unknown>
        | undefined;
      if (!requirements) continue;

      for (const key of PIN_KEYS) {
        const value = requirements[key];
        if (typeof value === "string" && value.length > 0) {
          offenders.push(`${route} → ${key}: "${value}"`);
        }
      }
    }

    expect(
      offenders,
      [
        "Route config must not pin a provider or model.",
        "A pin here cannot be cleared from the portal and strands the route when that provider is disabled.",
        "Express the need instead — defaultMinimumTier, qualityTier, minimumDimensions, reasoning floor — and let routing choose.",
        "See docs/founder-kernel/wiki/principles/no-provider-pinning.md.",
        "",
        "Pinned routes found:",
        ...offenders.map((o) => `  ${o}`),
      ].join("\n"),
    ).toEqual([]);
  });
});
