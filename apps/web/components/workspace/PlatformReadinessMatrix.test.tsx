import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PlatformReadinessMatrix } from "./PlatformReadinessMatrix";
import type { BusinessDomainReadiness } from "@/lib/workspace/command-center";

const readiness: BusinessDomainReadiness[] = [
  {
    id: "ai",
    label: "AI workforce",
    href: "/platform/ai/operations-map",
    cells: [
      { key: "context", label: "Context", description: "Evidence and operating knowledge", state: "good", href: "/wiki" },
      { key: "connections", label: "Connections", description: "Provider and integration links", state: "attention", href: "/platform/tools/integrations" },
      { key: "capabilities", label: "Capabilities", description: "People and AI coworkers able to act", state: "good", href: "/platform/ai" },
      { key: "cadence", label: "Cadence", description: "Scheduled work and follow-up rhythm", state: "good", href: "/workspace" },
      { key: "confidence", label: "Confidence", description: "Recent receipts and low-risk signals", state: "attention", href: "/platform/ai/operations-map" },
      { key: "containment", label: "Containment", description: "Approvals and side-effect controls", state: "blocked", href: "/platform/ai/authority" },
    ],
  },
];

describe("PlatformReadinessMatrix", () => {
  it("renders the six-C labels and domain heading", () => {
    const html = renderToStaticMarkup(<PlatformReadinessMatrix readiness={readiness} />);

    expect(html).toContain("Domain readiness");
    for (const label of ["Context", "Connections", "Capabilities", "Cadence", "Confidence", "Containment"]) {
      expect(html).toContain(label);
    }
    // Cell descriptions ride in titles, not as a separate visible tier.
    expect(html).toContain("Context: Good - Evidence and operating knowledge");
  });

  it("renders nothing for an empty matrix", () => {
    const html = renderToStaticMarkup(<PlatformReadinessMatrix readiness={[]} />);
    expect(html).toBe("");
  });

  it("uses DPF theme tokens, not hardcoded colors", () => {
    const html = renderToStaticMarkup(<PlatformReadinessMatrix readiness={readiness} />);
    expect(html).toContain("var(--dpf-");
    expect(html).not.toMatch(/text-gray-|bg-gray-|border-gray-|text-white|text-black|bg-white|#[0-9a-fA-F]{3,6}/);
  });
});
