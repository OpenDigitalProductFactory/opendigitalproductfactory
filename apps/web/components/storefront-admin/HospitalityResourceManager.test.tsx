import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { HospitalityResourceManager } from "./HospitalityResourceManager";

describe("HospitalityResourceManager", () => {
  it("renders business-legible table capacity without provider vocabulary", () => {
    const html = renderToStaticMarkup(
      createElement(HospitalityResourceManager, {
        storefrontId: "storefront-1",
        resources: [
          {
            id: "table-1",
            resourceId: "HR-T1",
            label: "Aster",
            kind: "table",
            status: "active",
            capacity: 4,
            capacityUnit: "seats",
            serviceArea: "Dining room",
            blockedReason: null,
            version: 2,
            availability: [
              {
                id: "availability-1",
                days: [5, 6],
                startTime: "17:00",
                endTime: "22:00",
                date: null,
                isBlocked: false,
                reason: null,
              },
            ],
          },
          {
            id: "table-2",
            resourceId: "HR-T2",
            label: "Birch",
            kind: "table",
            status: "blocked",
            capacity: 2,
            capacityUnit: "seats",
            serviceArea: "Patio",
            blockedReason: "Loose leg",
            version: 1,
            availability: [],
          },
        ],
      }),
    );

    expect(html).toContain("Aster");
    expect(html).toContain("4 seats");
    expect(html).toContain("Dining room");
    expect(html).toContain("Blocked");
    expect(html).toContain("Loose leg");
    expect(html).toContain("Add table");
    expect(html).toContain("Table availability");
    expect(html).not.toMatch(/\bprovider\b/i);
  });

  it("has an accessible management alternative to the graphical floor", () => {
    const html = renderToStaticMarkup(
      createElement(HospitalityResourceManager, {
        storefrontId: "storefront-1",
        resources: [],
      }),
    );
    expect(html).toContain("Table management");
    expect(html).toContain("No tables yet");
    expect(html).toContain('aria-label="Add table"');
  });
});
