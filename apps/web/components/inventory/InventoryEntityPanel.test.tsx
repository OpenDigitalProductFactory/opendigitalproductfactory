import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InventoryEntityPanel } from "./InventoryEntityPanel";

describe("InventoryEntityPanel", () => {
  it("renders confidence from the discovered inventory model", () => {
    const html = renderToStaticMarkup(
      <InventoryEntityPanel
        entities={[
          {
            id: "ent-1",
            entityKey: "host:desktop",
            name: "Desktop Host",
            entityType: "host",
            status: "active",
            attributionStatus: "needs_review",
            confidence: 0.85,
            portfolio: { slug: "foundational", name: "Foundational" },
            taxonomyNode: { nodeId: "foundational/compute", name: "Compute" },
            digitalProduct: null,
          },
        ]}
      />,
    );

    expect(html).toContain("85% confidence");
  });
});
