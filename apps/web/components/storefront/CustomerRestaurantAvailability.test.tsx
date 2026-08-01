import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CustomerRestaurantAvailability } from "./CustomerRestaurantAvailability";

describe("CustomerRestaurantAvailability", () => {
  it("shows honest current and forward table capacity in customer language", () => {
    const html = renderToStaticMarkup(
      <CustomerRestaurantAvailability
        availability={{
          asOf: "2026-07-31T18:14:00.000Z",
          summary: {
            totalTables: 3,
            availableNow: 1,
            availableSoon: 1,
          },
          tables: [
            {
              key: "availability-1",
              capacity: 2,
              shape: "round",
              serviceArea: "Main dining",
              availability: {
                kind: "now",
                availableAt: "2026-07-31T18:14:00.000Z",
                minutes: 0,
                explanation: "Available now",
              },
            },
            {
              key: "availability-2",
              capacity: 4,
              shape: "booth",
              serviceArea: "Window",
              availability: {
                kind: "at",
                availableAt: "2026-07-31T18:35:00.000Z",
                minutes: 21,
                explanation: "Available in about 21 minutes",
              },
            },
            {
              key: "availability-3",
              capacity: 6,
              shape: "rectangle",
              serviceArea: "Patio",
              availability: {
                kind: "unavailable",
                availableAt: null,
                minutes: null,
                explanation: "Availability will be confirmed when you book",
              },
            },
          ],
        }}
      />,
    );

    expect(html).toContain("Table availability");
    expect(html).toContain("1 table available now");
    expect(html).toContain("Seats up to 2");
    expect(html).toContain("Available in about 21 minutes");
    expect(html).toContain("Availability will be confirmed when you book");
    expect(html).toContain("Live estimate");
  });

  it("does not render operator-only facts even if they appear on the source object", () => {
    const availability = {
      asOf: "2026-07-31T18:14:00.000Z",
      summary: { totalTables: 1, availableNow: 1, availableSoon: 0 },
      tables: [
        {
          key: "availability-1",
          capacity: 2,
          shape: "square" as const,
          serviceArea: "Main dining",
          availability: {
            kind: "now" as const,
            availableAt: "2026-07-31T18:14:00.000Z",
            minutes: 0,
            explanation: "Available now",
          },
          party: { name: "Private Guest" },
          server: { name: "Private Server" },
          internalTableId: "persisted-table-123",
        },
      ],
    };

    const html = renderToStaticMarkup(
      <CustomerRestaurantAvailability availability={availability} />,
    );

    expect(html).not.toContain("Private Guest");
    expect(html).not.toContain("Private Server");
    expect(html).not.toContain("persisted-table-123");
  });

  it("bounds the public detail list while keeping the full venue count honest", () => {
    const html = renderToStaticMarkup(
      <CustomerRestaurantAvailability
        availability={{
          asOf: "2026-07-31T18:14:00.000Z",
          summary: {
            totalTables: 14,
            availableNow: 14,
            availableSoon: 0,
          },
          tables: Array.from({ length: 14 }, (_, index) => ({
            key: `availability-${index + 1}`,
            capacity: index + 1,
            shape: "square" as const,
            serviceArea: "Main dining",
            availability: {
              kind: "now" as const,
              availableAt: "2026-07-31T18:14:00.000Z",
              minutes: 0,
              explanation: "Available now",
            },
          })),
        }}
      />,
    );

    expect(html).toContain("12 of 14 table options shown");
    expect(html).toContain("Seats up to 12");
    expect(html).not.toContain("Seats up to 13");
  });
});
