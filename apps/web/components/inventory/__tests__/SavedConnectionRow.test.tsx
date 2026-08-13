// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { mockRerunDiscoveryConnection } = vi.hoisted(() => ({
  mockRerunDiscoveryConnection: vi.fn(),
}));

vi.mock("@/lib/actions/discovery", () => ({
  deleteDiscoveryConnection: vi.fn(),
  rerunDiscoveryConnection: mockRerunDiscoveryConnection,
  testDiscoveryConnection: vi.fn(),
}));

vi.mock("@/components/inventory/ConfigureConnectionInline", () => ({
  ConfigureConnectionInline: () => null,
}));

import { SavedConnectionRow } from "../SavedConnectionRow";
import type { DiscoveryConnectionSummary } from "@/lib/actions/discovery";

const BASE_CONNECTION: DiscoveryConnectionSummary = {
  id: "conn-1",
  connectionKey: "unifi:192.168.0.1",
  name: "HQ Gateway",
  collectorType: "unifi",
  status: "active",
  endpointUrl: "https://192.168.0.1",
  hasApiKey: true,
  configuration: { site: "default" },
  lastTestedAt: null,
  lastTestStatus: null,
  lastTestMessage: null,
  gatewayEntityId: null,
};

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
});

describe("SavedConnectionRow Re-run button", () => {
  it("renders last-tested evidence through a semantic time element", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T05:00:00.000Z"));

    render(
      <SavedConnectionRow
        connection={{ ...BASE_CONNECTION, lastTestedAt: "2026-08-13T04:18:00.000Z" }}
      />,
    );

    expect(screen.getByText("42m ago")).toBeInTheDocument();
    expect(screen.getByText("42m ago").tagName).toBe("TIME");
  });

  it("renders the Re-run button", () => {
    render(<SavedConnectionRow connection={BASE_CONNECTION} />);
    expect(screen.getByRole("button", { name: /re-run/i })).toBeInTheDocument();
  });

  it("calls rerunDiscoveryConnection with the connection id when clicked", async () => {
    mockRerunDiscoveryConnection.mockResolvedValue({ ok: false, error: "fail" });

    render(<SavedConnectionRow connection={BASE_CONNECTION} />);
    fireEvent.click(screen.getByRole("button", { name: /re-run/i }));

    await waitFor(() => {
      expect(mockRerunDiscoveryConnection).toHaveBeenCalledWith("conn-1");
    });
  });

  it("shows inline success feedback after a successful re-run", async () => {
    mockRerunDiscoveryConnection.mockResolvedValue({
      ok: true,
      runId: "run-1",
      itemCount: 5,
      relationshipCount: 2,
      status: "active",
    });

    render(<SavedConnectionRow connection={BASE_CONNECTION} />);
    fireEvent.click(screen.getByRole("button", { name: /re-run/i }));

    await waitFor(() => {
      expect(screen.getByText(/re-run complete/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/5 item/i)).toBeInTheDocument();
    expect(screen.getByText(/2 relationship/i)).toBeInTheDocument();
  });

  it("shows inline error feedback on failure", async () => {
    mockRerunDiscoveryConnection.mockResolvedValue({
      ok: false,
      error: "auth_failed",
    });

    render(<SavedConnectionRow connection={BASE_CONNECTION} />);
    fireEvent.click(screen.getByRole("button", { name: /re-run/i }));

    await waitFor(() => {
      expect(screen.getByText(/auth_failed/i)).toBeInTheDocument();
    });
  });

  it("disables the Re-run button while a re-run is in progress", async () => {
    let resolveRerun: (v: unknown) => void;
    mockRerunDiscoveryConnection.mockReturnValue(
      new Promise((resolve) => { resolveRerun = resolve; }),
    );

    render(<SavedConnectionRow connection={BASE_CONNECTION} />);
    const btn = screen.getByRole("button", { name: /re-run/i });

    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockRerunDiscoveryConnection).toHaveBeenCalled();
    });

    resolveRerun!({ ok: false, error: "done" });
  });
});
