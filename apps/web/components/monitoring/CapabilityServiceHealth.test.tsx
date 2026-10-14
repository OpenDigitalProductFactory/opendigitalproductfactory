import { renderToStaticMarkup } from "react-dom/server";
import { measureUxBudget } from "@/lib/ux-budget/measure";
import { describe, expect, it } from "vitest";

import type { CapabilityServiceHealthProjection } from "@/lib/platform-runtime/service-health";
import { CapabilityServiceHealth } from "./CapabilityServiceHealth";

const projection: CapabilityServiceHealthProjection = {
  aggregate: {
    value: "Degraded",
    tone: "warning",
    detail: "portal and browser-use require attention",
  },
  items: [
    {
      key: "portal",
      kind: "service",
      state: "required",
      availability: "unavailable",
      label: "Required — unavailable",
      action: "Restore the service and verify its configured health check.",
      tone: "warning",
      healthSemantics: "http",
    },
    {
      key: "speech-to-text",
      kind: "service",
      state: "optional_inactive",
      availability: "inactive",
      label: "Optional — inactive",
      action: "Enable its runtime capability when this service is needed.",
      tone: "neutral",
      healthSemantics: "http",
    },
    {
      key: "browser-use",
      kind: "service",
      state: "optional_degraded",
      availability: "unavailable",
      label: "Optional — degraded",
      action: "Restore the enabled optional service or disable its runtime capability.",
      tone: "warning",
      healthSemantics: "http",
    },
    {
      key: "openai",
      kind: "runtime",
      state: "external",
      availability: "available",
      label: "External — provider managed",
      action: "Manage availability and credentials with the configured provider.",
      tone: "neutral",
      healthSemantics: "provider-api",
    },
  ],
};

describe("CapabilityServiceHealth", () => {
  it("keeps active requirements visible and retains inactive services in a closed native disclosure", () => {
    const html = renderToStaticMarkup(<CapabilityServiceHealth projection={projection} />);
    const disclosure = html.match(/<details\b([^>]*)>([\s\S]*?)<\/details>/);
    expect(disclosure).not.toBeNull();
    expect(disclosure?.[1]).not.toMatch(/\bopen\b/);
    expect(disclosure?.[2]).toContain("Inactive optional services (1)");
    expect(disclosure?.[2]).toContain("speech-to-text");
    for (const key of ["portal", "browser-use", "openai"]) {
      expect(disclosure?.[2]).not.toContain(key);
    }
    expect(html.match(/<li\b/g)).toHaveLength(projection.items.length);
  });

  it("does not let inactive inventory dominate arrival or retain sub-legible navigation", () => {
    const items = Array.from({ length: 18 }, (_, index) => ({ ...projection.items[1]!,
      key: `optional-${index}`, actionHref: "/admin/settings/monitoring" }));
    const active = projection.items.filter(item => item.state !== "optional_inactive");
    const small = measureUxBudget(renderToStaticMarkup(<CapabilityServiceHealth projection={{ ...projection, items: active }} />));
    const html = renderToStaticMarkup(<CapabilityServiceHealth projection={{ ...projection, items: [...active, ...items] }} />);
    const measured = measureUxBudget(html);
    expect(measured.defaultVisibleWords).toBeLessThanOrEqual(small.defaultVisibleWords + 8);
    const links = [...html.matchAll(/<a\b[^>]*>/g)];
    expect(links).toHaveLength(18);
    for (const link of links) expect(link[0]).not.toMatch(/text-\[(?:9|10|11)px\]/);
    expect(measureUxBudget(html.replace(/<details\b([^>]*)>/, "<details$1 open>")).subLegibleControls).toBe(0);
  });

  it("shows a shared required-service remedy once without hiding distinct critical actions", () => {
    const first = projection.items[0]!;
    const html = renderToStaticMarkup(<CapabilityServiceHealth projection={{ ...projection, items: [
      first, { ...first, key: "postgres" }, projection.items[2]!, projection.items[3]!,
    ] }} />);
    expect(html.split(first.action)).toHaveLength(2);
    expect(html).toContain("Required services:");
    expect(html).toContain(projection.items[2]!.action);
    expect(html).toContain(projection.items[3]!.action);
    expect(html).toContain("portal");
    expect(html).toContain("postgres");
  });

  it("renders all requirement states with explicit non-color meaning", () => {
    const html = renderToStaticMarkup(<CapabilityServiceHealth projection={projection} />);

    expect(html).toContain("Required — unavailable");
    expect(html).toContain("Optional — inactive");
    expect(html).toContain("Optional — degraded");
    expect(html).toContain("External — provider managed");
    expect(html).toContain("Enable its runtime capability");
    expect(html).toContain("Restore the enabled optional service");
    expect(html).toContain("Manage availability and credentials");
    expect(html).toContain("Availability: Unavailable");
    expect(html).toContain("Availability: Inactive");
    expect(html).toContain("Availability: Available");
    expect(html.match(/aria-hidden="true"/g)?.length).toBe(4);
  });

  it("uses a semantic labelled section and responsive grid", () => {
    const html = renderToStaticMarkup(<CapabilityServiceHealth projection={projection} />);

    expect(html).toContain("<section");
    expect(html).toContain('aria-labelledby="capability-service-health-title"');
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("sm:grid-cols-2");
    expect(html).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it("distinguishes unknown and unhealthy provider observations without claiming availability", () => {
    const html = renderToStaticMarkup(
      <CapabilityServiceHealth
        projection={{
          aggregate: { value: "Operational", tone: "success", detail: "Required services available" },
          items: [
            {
              key: "openai",
              kind: "runtime",
              state: "external",
              availability: "unknown",
              label: "External — provider managed",
              detail: "No recent activity. Health will update after the next request.",
              action: "Run a request to establish current provider health.",
              tone: "neutral",
              healthSemantics: "provider-health-reconciliation",
            },
            {
              key: "anthropic",
              kind: "runtime",
              state: "external",
              availability: "unavailable",
              label: "External — provider managed",
              detail: "Recent requests are failing. Check this provider's settings.",
              action: "Open provider settings to restore availability.",
              actionHref: "/platform/ai/providers/anthropic",
              tone: "warning",
              healthSemantics: "provider-health-reconciliation",
            },
          ],
        }}
      />,
    );

    expect(html).toContain("No recent activity");
    expect(html).toContain("Availability: Unknown");
    expect(html).toContain("Availability: Unavailable");
    expect(html).toContain("Run a request to establish current provider health");
    expect(html).toContain("Recent requests are failing");
    expect(html).toContain('href="/platform/ai/providers/anthropic"');
    expect(html).toContain("focus-visible:ring-2");
  });
});
