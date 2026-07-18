import { renderToStaticMarkup } from "react-dom/server";
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
  it("renders all requirement states with explicit non-color meaning", () => {
    const html = renderToStaticMarkup(<CapabilityServiceHealth projection={projection} />);

    expect(html).toContain("Required — unavailable");
    expect(html).toContain("Optional — inactive");
    expect(html).toContain("Optional — degraded");
    expect(html).toContain("External — provider managed");
    expect(html).toContain("Enable its runtime capability");
    expect(html).toContain("Restore the enabled optional service");
    expect(html).toContain("Manage availability and credentials");
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
});
