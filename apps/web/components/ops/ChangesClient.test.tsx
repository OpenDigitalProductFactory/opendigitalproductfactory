// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ChangesClient from "./ChangesClient";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const baseRfc = {
  id: "db-rfc-1",
  rfcId: "RFC-2026-ONE",
  title: "Platform self-upgrade",
  description: "Upgrade the platform safely.",
  type: "standard",
  scope: "platform",
  riskLevel: "low",
  status: "in-progress",
  createdAt: "2026-07-06T12:50:02.000Z",
  submittedAt: "2026-07-06T12:50:02.000Z",
  assessedAt: "2026-07-06T12:50:02.000Z",
  approvedAt: "2026-07-06T12:50:02.000Z",
  scheduledAt: "2026-07-06T12:50:02.000Z",
  startedAt: "2026-07-06T12:50:02.000Z",
  completedAt: null,
  closedAt: null,
  impactReport: null,
  outcome: null,
  outcomeNotes: null,
  requestedBy: null,
  assessedBy: null,
  approvedBy: null,
  executedBy: null,
  changeItems: [{ id: "item-1", itemType: "release", title: "Deploy", status: "in-progress" }],
};

function jsonResponse(data: unknown) {
  return Promise.resolve({ ok: true, json: async () => ({ data }) } as Response);
}

describe("ChangesClient expandable RFC details", () => {
  it("keeps the UX sweep pending until the initial RFC list settles", async () => {
    let resolveList!: (response: Response) => void;
    const listRequest = new Promise<Response>((resolve) => {
      resolveList = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(() => listRequest));

    const { container } = render(<ChangesClient />);
    expect(container.querySelector('[data-dpf-ux-settle="pending"]')).not.toBeNull();

    resolveList({ ok: true, json: async () => ({ data: [] }) } as Response);

    await waitFor(() => {
      expect(container.querySelector("[data-dpf-ux-settle]")).toBeNull();
    });
    expect(screen.getByText('No changes with status "active".')).toBeTruthy();
  });

  it("keeps one summary, shows in-panel loading, and reveals connected detail", async () => {
    let resolveDetail!: (response: Response) => void;
    const detailRequest = new Promise<Response>((resolve) => {
      resolveDetail = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => jsonResponse([baseRfc]))
      .mockImplementationOnce(() => detailRequest);
    vi.stubGlobal("fetch", fetchMock);

    render(<ChangesClient />);
    const trigger = (await screen.findByText("RFC-2026-ONE")).closest("button")!;

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("Loading change details");
    expect(screen.getAllByText("RFC-2026-ONE")).toHaveLength(1);

    resolveDetail({ ok: true, json: async () => ({ data: baseRfc }) } as Response);
    expect(await screen.findByText("Approval Chain")).toBeTruthy();
    expect(screen.getAllByText("RFC-2026-ONE")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("keeps the summary usable when detail loading fails", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => jsonResponse([baseRfc]))
      .mockRejectedValueOnce(new Error("Detail service unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    render(<ChangesClient />);
    const trigger = (await screen.findByText("RFC-2026-ONE")).closest("button")!;
    fireEvent.click(trigger);

    expect((await screen.findByRole("alert")).textContent).toContain("Detail service unavailable");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(trigger);
    await waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("false"));
  });
});
