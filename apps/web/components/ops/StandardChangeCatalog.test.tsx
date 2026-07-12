// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StandardChangeCatalog } from "./StandardChangeCatalog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StandardChangeCatalog disclosure", () => {
  it("uses the shared connected disclosure for catalog detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "catalog-1",
              catalogKey: "PATCH",
              title: "Routine patch",
              description: "Apply a routine platform patch.",
              category: "maintenance",
              preAssessedRisk: "low",
              templateItems: [{ itemType: "patch", title: "Apply patch" }],
              approvalPolicy: "auto",
              validFrom: "2026-07-01T00:00:00.000Z",
              validUntil: null,
              approvedBy: null,
            },
          ],
        }),
      } as Response),
    );

    render(<StandardChangeCatalog />);
    const trigger = (await screen.findByText("PATCH")).closest("button")!;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("region").textContent).toContain("Template Items (1)");
    expect(screen.getAllByText("PATCH")).toHaveLength(1);
  });
});
