// @vitest-environment jsdom
//
// BI-7BCC87BB (founder decision DI-FFD78D222548): on the supervisor agent card,
// a pending approval request is decided with the same Authorize / Decline as
// Needs-you and the chat card, posted to the envelope routes. The owner gets
// the two buttons; an admin who is not the owner gets "Decide on their behalf"
// (AC-OVERRIDE); anyone else sees who it is waiting for and no control.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { AgentCardEnvelopeDecision } from "./AgentCardEnvelopeDecision";

const ENVELOPE = {
  envelopeId: "env-1",
  delegatingUserId: "owner-1",
  ownerLabel: "owner@x.test",
  toolName: "run_discovery_triage",
  actionLabel: "run discovery triage",
  rationale: "This coworker is set to propose, not act.",
  proposedAt: "2026-10-07T09:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z", // clock-bomb-guard: allow pass-through fixture; the code under test never compares it to the clock
  approveHref: "/api/agent/envelope/env-1/approve",
  declineHref: "/api/agent/envelope/env-1/deny",
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  refresh.mockClear();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, execution: { status: "executed", message: "Ran." } }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AgentCardEnvelopeDecision", () => {
  it("gives the owner Authorize and Decline, posting to the envelope route", async () => {
    render(<AgentCardEnvelopeDecision envelope={ENVELOPE} viewer={{ userId: "owner-1", isAdmin: false }} />);
    expect(screen.getByText(/run discovery triage/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Authorize" }));
    await waitFor(() => expect(screen.getByText("Authorized and done.")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("/api/agent/envelope/env-1/approve", expect.objectContaining({ method: "POST" }));
    expect(fetchMock.mock.calls[0]![1]).not.toHaveProperty("body");
    expect(screen.queryByRole("button", { name: "Decide on their behalf" })).toBeNull();
  });

  it("gives an admin who is not the owner the on-behalf control with a required reason", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true, onBehalf: { decision: "declined", by: "admin@x.test", onBehalfOf: "owner@x.test", reason: "Not needed." },
    }), { status: 200 }));
    render(<AgentCardEnvelopeDecision envelope={ENVELOPE} viewer={{ userId: "admin-1", isAdmin: true }} />);
    expect(screen.queryByRole("button", { name: "Authorize" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Decide on their behalf" }));
    fireEvent.change(screen.getByLabelText("Reason (recorded with the decision)"), { target: { value: "Not needed." } });
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(screen.getByText(/Decided by admin@x\.test on behalf of owner@x\.test: Not needed\./)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("/api/agent/envelope/env-1/deny", expect.objectContaining({
      body: JSON.stringify({ onBehalf: true, reason: "Not needed." }),
    }));
  });

  it("shows anyone else who it is waiting for, with no control", () => {
    render(<AgentCardEnvelopeDecision envelope={ENVELOPE} viewer={{ userId: "u-3", isAdmin: false }} />);
    expect(screen.getByText(/Waiting for owner@x\.test/)).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("shows the refusal the server returns", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "This request was already decided." }), { status: 409 }));
    render(<AgentCardEnvelopeDecision envelope={ENVELOPE} viewer={{ userId: "owner-1", isAdmin: false }} />);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(screen.getByText("This request was already decided.")).toBeTruthy());
  });
});
