import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { EstateItemCard } from "@/components/inventory/EstateItemCard";

describe("EstateItemCard", () => {
  it("renders estate identity, version, support, and dependency counts", () => {
    const html = renderToStaticMarkup(
      <EstateItemCard
        item={{
          id: "entity-1",
          name: "Main Gateway",
          entityKey: "gateway:main",
          iconKey: "gateway",
          technicalClassLabel: "Network Gateway",
          manufacturerLabel: "Ubiquiti",
          modelLabel: "Dream Machine Pro",
          identityLabel: "Dream Machine Pro",
          identityConfidenceLabel: "Normalized identity",
          identityConfidenceTone: "good",
          versionLabel: "4.0.2",
          versionSourceLabel: "Normalized from software evidence",
          supportStatus: "supported",
          supportStatusLabel: "Supported",
          supportTone: "good",
          supportSummaryLabel: "Covered by vendor support",
          advisorySummaryLabel: "No advisory findings recorded",
          versionConfidenceLabel: "High confidence version",
          versionConfidenceTone: "good",
          freshnessLabel: "Seen recently",
          freshnessTone: "good",
          blastRadiusLabel: "Failure impacts 5 downstream dependencies",
          postureBadges: [
            { label: "1 dependency gap", tone: "warn" },
            { label: "1 active alert", tone: "danger" },
          ],
          openIssueCount: 2,
          providerViewLabel: "foundational",
          taxonomyPath: "foundational / connectivity / network",
          upstreamCount: 2,
          downstreamCount: 5,
          statusLabel: "active",
        }}
      />,
    );

    expect(html).toContain("Main Gateway");
    expect(html).toContain("Network Gateway");
    expect(html).toContain("Ubiquiti");
    expect(html).toContain("Dream Machine Pro");
    expect(html).toContain("Normalized identity");
    expect(html).toContain("4.0.2");
    expect(html).toContain("Normalized from software evidence");
    expect(html).toContain("Supported");
    expect(html).toContain("Covered by vendor support");
    expect(html).toContain("No advisory findings recorded");
    expect(html).toContain("High confidence version");
    expect(html).toContain("Seen recently");
    expect(html).toContain("Failure impacts 5 downstream dependencies");
    expect(html).toContain("1 dependency gap");
    expect(html).toContain("1 active alert");
    expect(html).toContain("2 upstream");
    expect(html).toContain("5 downstream");
    expect(html).toContain("foundational / connectivity / network");
  });
});
