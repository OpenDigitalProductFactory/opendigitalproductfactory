// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { HospitalityResourceManager } from "./HospitalityResourceManager";

beforeEach(() => {
  refresh.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
            attributes: {
              shape: "booth",
              combinationGroup: "main-banquette",
              combinableWith: [],
              bookingAccess: "online",
            },
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
            attributes: {
              shape: "round",
              combinationGroup: null,
              combinableWith: [],
              bookingAccess: "online",
            },
            version: 1,
            availability: [],
          },
        ],
      }),
    );

    expect(html).toContain("Aster");
    expect(html).toContain("4 seats");
    expect(html).toContain("Dining room");
    expect(html).toContain("Booth");
    expect(html).toContain("main-banquette");
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

  it("refreshes the operational floor and readiness counts after adding a table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          resource: {
            id: "table-1",
            resourceId: "HR-T1",
            label: "Aster 12",
            kind: "table",
            status: "active",
            capacity: 4,
            capacityUnit: "seats",
            serviceArea: "Dining room",
            blockedReason: null,
            attributes: {
              shape: "square",
              combinationGroup: null,
              combinableWith: [],
              bookingAccess: "online",
            },
            version: 1,
            availability: [],
          },
        }),
      }),
    );

    render(
      <HospitalityResourceManager
        storefrontId="storefront-1"
        resources={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add table" }));
    fireEvent.change(screen.getByLabelText("Table label"), {
      target: { value: "Aster 12" },
    });
    fireEvent.change(screen.getByLabelText("Service area"), {
      target: { value: "Dining room" },
    });
    fireEvent.change(screen.getByLabelText("Table shape"), {
      target: { value: "square" },
    });
    fireEvent.click(
      screen.getByText("Add table", {
        selector: "button:not([aria-label])",
      }),
    );

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("refreshes the operational floor after changing a table status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          resource: {
            id: "table-1",
            resourceId: "HR-T1",
            label: "Aster 12",
            kind: "table",
            status: "blocked",
            capacity: 4,
            capacityUnit: "seats",
            serviceArea: "Dining room",
            blockedReason: "Maintenance",
            attributes: {
              shape: "booth",
              combinationGroup: "main-banquette",
              combinableWith: [],
              bookingAccess: "online",
            },
            version: 2,
            availability: [],
          },
        }),
      }),
    );

    render(
      <HospitalityResourceManager
        storefrontId="storefront-1"
        resources={[
          {
            id: "table-1",
            resourceId: "HR-T1",
            label: "Aster 12",
            kind: "table",
            status: "active",
            capacity: 4,
            capacityUnit: "seats",
            serviceArea: "Dining room",
            blockedReason: null,
            attributes: {
              shape: "round",
              combinationGroup: null,
              combinableWith: [],
              bookingAccess: "online",
            },
            version: 1,
            availability: [],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByText("Aster 12"));
    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "blocked" },
    });
    fireEvent.change(screen.getByLabelText("Why is it blocked?"), {
      target: { value: "Maintenance" },
    });
    fireEvent.change(screen.getByLabelText("Table shape"), {
      target: { value: "booth" },
    });
    fireEvent.change(screen.getByLabelText(/^Combination group/), {
      target: { value: "main-banquette" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save table" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const fetchMock = vi.mocked(fetch);
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ) as Record<string, unknown>;
    expect(body).toMatchObject({
      shape: "booth",
      combinationGroup: "main-banquette",
    });
  });
});
