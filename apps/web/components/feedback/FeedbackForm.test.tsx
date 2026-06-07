// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/quality-queue", () => ({
  submitReport: vi.fn(async () => ({ ok: true, reportId: "PIR-ABCDE" })),
}));

vi.mock("@/lib/actions/feedback-escalation", () => ({
  getUpstreamFeedbackConsent: vi.fn(),
  setUpstreamFeedbackOptIn: vi.fn(async () => ({ ok: true, optIn: true })),
  fileUpstreamFeedback: vi.fn(),
}));

import { FeedbackForm } from "./FeedbackForm";
import {
  getUpstreamFeedbackConsent,
  setUpstreamFeedbackOptIn,
  fileUpstreamFeedback,
} from "@/lib/actions/feedback-escalation";

const mockConsent = vi.mocked(getUpstreamFeedbackConsent);
const mockOptIn = vi.mocked(setUpstreamFeedbackOptIn);
const mockFile = vi.mocked(fileUpstreamFeedback);

async function submitAReport() {
  fireEvent.change(screen.getByPlaceholderText(/describe what happened/i), {
    target: { value: "Dashboard crashed" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  await screen.findByText(/Report PIR-ABCDE filed/);
}

describe("FeedbackForm — upstream escalation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConsent.mockResolvedValue({ optIn: false, relayConfigured: true, forkOnly: false, paused: false });
    mockFile.mockResolvedValue({ status: "filed", ok: true, issueNumber: 5, url: "https://github.com/o/r/issues/5" });
  });

  afterEach(() => cleanup());

  it("shows the report-to-project-team affordance after a report is filed", async () => {
    render(<FeedbackForm routeContext="/build" />);
    await submitAReport();
    expect(screen.getByRole("button", { name: /report to the project team/i })).toBeInTheDocument();
  });

  it("prompts for consent on first use, then files and shows the issue link", async () => {
    render(<FeedbackForm routeContext="/build" />);
    await submitAReport();

    fireEvent.click(screen.getByRole("button", { name: /report to the project team/i }));
    await screen.findByText(/Send this report to the project team\?/);
    expect(mockFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /send & remember/i }));

    await waitFor(() => expect(mockOptIn).toHaveBeenCalledWith({ enabled: true }));
    expect(mockFile).toHaveBeenCalledWith({ reportId: "PIR-ABCDE" });
    const link = await screen.findByRole("link", { name: /view issue/i });
    expect(link).toHaveAttribute("href", "https://github.com/o/r/issues/5");
  });

  it("files directly without a consent prompt when already opted in", async () => {
    mockConsent.mockResolvedValue({ optIn: true, relayConfigured: true, forkOnly: false, paused: false });
    render(<FeedbackForm routeContext="/build" />);
    await submitAReport();

    fireEvent.click(screen.getByRole("button", { name: /report to the project team/i }));

    await waitFor(() => expect(mockFile).toHaveBeenCalledWith({ reportId: "PIR-ABCDE" }));
    expect(mockOptIn).not.toHaveBeenCalled();
    expect(screen.queryByText(/Send this report to the project team\?/)).not.toBeInTheDocument();
    await screen.findByText(/Sent to the project team/);
  });

  it("hides escalation for fork_only installs", async () => {
    mockConsent.mockResolvedValue({ optIn: false, relayConfigured: false, forkOnly: true, paused: false });
    render(<FeedbackForm routeContext="/build" />);
    await submitAReport();

    fireEvent.click(screen.getByRole("button", { name: /report to the project team/i }));
    await screen.findByText(/turned off for this install/i);
    expect(mockFile).not.toHaveBeenCalled();
  });

  it("surfaces a failure reason from the action", async () => {
    mockConsent.mockResolvedValue({ optIn: true, relayConfigured: true, forkOnly: false, paused: false });
    mockFile.mockResolvedValue({ ok: false, status: "failed", reason: "Relay error: boom" });
    render(<FeedbackForm routeContext="/build" />);
    await submitAReport();

    fireEvent.click(screen.getByRole("button", { name: /report to the project team/i }));
    await screen.findByText(/Couldn.t send to the project team: Relay error: boom/);
  });
});
