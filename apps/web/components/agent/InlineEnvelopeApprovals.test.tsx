// @vitest-environment jsdom
//
// BI-7BCC87BB (spec D2 S1, AC-UX): the chat card authorizes the request the
// coworker raised, and on success hands the run's result id to the panel, so
// the follow-up keeps today's "Result: <id>" text.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InlineEnvelopeApprovals } from "./InlineEnvelopeApprovals";
import { approvalFollowUpMessage } from "@/lib/tak/approval-follow-up";

const REQUEST = {
  envelopeId: "env-1",
  toolName: "contribute_to_hive",
  status: "proposed",
  expiresAt: "2099-01-01T00:15:00.000Z", // clock-bomb-guard: allow pass-through fixture; the code under test never compares it to the clock
  rationale: "This action is defined as a proposal, so a person decides it.",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("InlineEnvelopeApprovals — authorizing from chat", () => {
  it("hands the run's result id to the panel after an authorized run", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ok: true, execution: { status: "executed", message: "Contributed.", entityId: "HIVE-1" },
    }), { status: 200 })));
    const onAuthorized = vi.fn();
    render(<InlineEnvelopeApprovals requests={[REQUEST]} onAuthorized={onAuthorized} />);
    fireEvent.click(screen.getByRole("button", { name: "Authorize" }));
    await waitFor(() => expect(onAuthorized).toHaveBeenCalledWith({ toolName: "contribute_to_hive", entityId: "HIVE-1" }));
    expect(screen.getByText("Authorized and done.")).toBeTruthy();
  });

  it("does not follow up when the run did not complete, or on decline", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, execution: { status: "failed", message: "No grant." } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onAuthorized = vi.fn();
    render(<InlineEnvelopeApprovals requests={[REQUEST, { ...REQUEST, envelopeId: "env-2" }]} onAuthorized={onAuthorized} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Authorize" })[0]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getAllByRole("button", { name: "Decline" })[0]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(onAuthorized).not.toHaveBeenCalled();
  });
});

describe("approvalFollowUpMessage", () => {
  it("keeps today's follow-up wording, with and without a result id", () => {
    expect(approvalFollowUpMessage("contribute_to_hive", "HIVE-1")).toBe("I approved contribute to hive. Result: HIVE-1. What's next?");
    expect(approvalFollowUpMessage("contribute_to_hive")).toBe("I approved contribute to hive. What's next?");
  });
});
