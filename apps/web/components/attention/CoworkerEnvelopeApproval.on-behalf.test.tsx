// @vitest-environment jsdom
//
// BI-7BCC87BB (plan B8, AC-OVERRIDE, AC-UX): an admin who is not the delegate
// opens the request's exact link and sees "Decide on their behalf" instead of
// Authorize / Decline. Deciding needs a reason; the settled card names the
// admin, the owner and the reason. The delegate's own card is unchanged.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, replace } = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, replace }) }));

import { CoworkerEnvelopeApproval } from "./CoworkerEnvelopeApproval";
import { summarizeCoworkerEnvelopeDecision } from "@/lib/attention/coworker-envelope-decision";
import type { AttentionEnvelopeApproval } from "@/lib/attention/types";

function approval(over: Partial<AttentionEnvelopeApproval> = {}): AttentionEnvelopeApproval {
  return {
    envelopeId: "env-1",
    coworkerAgentId: "AGT-OPS",
    delegatingUserId: "owner-1",
    manifestActionId: "run_discovery_triage",
    rationale: "This coworker is set to propose, not act.",
    status: "proposed",
    taskRunId: null,
    expiresAtIso: "2099-01-01T00:00:00.000Z",
    actionable: true,
    approveHref: "/api/agent/envelope/env-1/approve",
    declineHref: "/api/agent/envelope/env-1/deny",
    decision: summarizeCoworkerEnvelopeDecision({
      toolName: "run_discovery_triage",
      proposedParameters: {},
      recommenderAgentId: "AGT-OPS",
      authorizerUserId: "owner-1",
    }),
    ...over,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  refresh.mockClear();
  replace.mockClear();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({
    ok: true,
    execution: { status: "executed", message: "Triage ran." },
    onBehalf: { decision: "approved", by: "admin@x.test", onBehalfOf: "owner@x.test", reason: "Owner is away." },
  }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CoworkerEnvelopeApproval — deciding on someone's behalf", () => {
  it("offers only 'Decide on their behalf' to an admin who is not the delegate", () => {
    render(<CoworkerEnvelopeApproval approval={approval({ onBehalf: { ownerLabel: "owner@x.test" } })} />);
    expect(screen.getByText(/waiting for owner@x\.test/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decide on their behalf" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Authorize" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
  });

  it("needs a reason before Authorize or Decline can be pressed", () => {
    render(<CoworkerEnvelopeApproval approval={approval({ onBehalf: { ownerLabel: "owner@x.test" } })} />);
    fireEvent.click(screen.getByRole("button", { name: "Decide on their behalf" }));
    const authorize = screen.getByRole("button", { name: "Authorize" }) as HTMLButtonElement;
    const decline = screen.getByRole("button", { name: "Decline" }) as HTMLButtonElement;
    expect(authorize.disabled).toBe(true);
    expect(decline.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason (recorded with the decision)"), { target: { value: "   " } });
    expect(authorize.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason (recorded with the decision)"), { target: { value: "Owner is away." } });
    expect(authorize.disabled).toBe(false);
    expect(decline.disabled).toBe(false);
  });

  it("posts the reason on behalf, then names the admin, the owner and the reason", async () => {
    render(<CoworkerEnvelopeApproval approval={approval({ onBehalf: { ownerLabel: "owner@x.test" } })} />);
    fireEvent.click(screen.getByRole("button", { name: "Decide on their behalf" }));
    fireEvent.change(screen.getByLabelText("Reason (recorded with the decision)"), { target: { value: "Owner is away." } });
    fireEvent.click(screen.getByRole("button", { name: "Authorize" }));

    await waitFor(() => expect(screen.getByText(/Decided by admin@x\.test on behalf of owner@x\.test: Owner is away\./)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("/api/agent/envelope/env-1/approve", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ onBehalf: true, reason: "Owner is away." }),
    }));
    expect(screen.getByText(/Authorized and done\./)).toBeTruthy();
  });

  it("declines on behalf through the decline endpoint with the reason", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      onBehalf: { decision: "declined", by: "admin@x.test", onBehalfOf: "owner@x.test", reason: "Not wanted." },
    }), { status: 200 }));
    render(<CoworkerEnvelopeApproval approval={approval({ onBehalf: { ownerLabel: "owner@x.test" } })} />);
    fireEvent.click(screen.getByRole("button", { name: "Decide on their behalf" }));
    fireEvent.change(screen.getByLabelText("Reason (recorded with the decision)"), { target: { value: "Not wanted." } });
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(screen.getByText(/Decided by admin@x\.test on behalf of owner@x\.test: Not wanted\./)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("/api/agent/envelope/env-1/deny", expect.objectContaining({
      body: JSON.stringify({ onBehalf: true, reason: "Not wanted." }),
    }));
  });

  it("leaves the delegate's own card with Authorize and Decline and no override", () => {
    render(<CoworkerEnvelopeApproval approval={approval()} />);
    expect(screen.getByRole("button", { name: "Authorize" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Decide on their behalf" })).toBeNull();
  });
});
