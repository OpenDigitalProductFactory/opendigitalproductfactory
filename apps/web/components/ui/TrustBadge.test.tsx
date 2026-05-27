import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TrustBadge } from "@/components/ui/TrustBadge";
import { scoreTrustVector } from "@/lib/trust-vector";

function trust(score: number, rationale = "Latest scan completed today.") {
  return scoreTrustVector({
    subject: {
      type: "assurance-scan",
      id: "scan-1",
      label: "Build assurance scan",
    },
    asOf: "2026-05-26T12:00:00.000Z",
    dimensions: [
      {
        key: "freshness",
        label: "Freshness",
        score,
        rationale,
        evidenceRefs: [],
      },
      {
        key: "sourceAuthority",
        label: "Source authority",
        score: 1,
        rationale: "AssuranceRun is authoritative.",
        evidenceRefs: [],
      },
    ],
  });
}

describe("TrustBadge", () => {
  it("renders compact high-trust state with accessible rationale", () => {
    const html = renderToStaticMarkup(<TrustBadge trust={trust(1)} compact />);

    expect(html).toContain('data-trust-tier="high"');
    expect(html).toContain("High trust");
    expect(html).toContain("All trust dimensions are strong.");
    expect(html).toContain("aria-label=");
  });

  it("renders expandable dimension detail", () => {
    const html = renderToStaticMarkup(
      <TrustBadge
        trust={trust(0.2, "Latest scan completed 45 days ago.")}
        disclosureLabel="Trust details"
      />,
    );

    expect(html).toContain("<details");
    expect(html).toContain("Trust details");
    expect(html).toContain("Freshness");
    expect(html).toContain("Latest scan completed 45 days ago.");
  });

  it("uses DPF theme tokens rather than hardcoded colors", () => {
    const html = renderToStaticMarkup(<TrustBadge trust={trust(0.2)} />);

    expect(html).toContain("var(--dpf-");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}|text-gray|bg-white|border-gray/);
  });
});
