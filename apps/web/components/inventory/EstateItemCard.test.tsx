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
          versionLabel: "4.0.2",
          supportStatus: "supported",
          supportStatusLabel: "Supported",
          supportTone: "good",
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
    expect(html).toContain("4.0.2");
    expect(html).toContain("Supported");
    expect(html).toContain("2 upstream");
    expect(html).toContain("5 downstream");
    expect(html).toContain("foundational / connectivity / network");
  });
});
