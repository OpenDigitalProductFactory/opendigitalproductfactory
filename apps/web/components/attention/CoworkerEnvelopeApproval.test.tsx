// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, approveProposal, rejectProposal } = vi.hoisted(() => ({
  refresh: vi.fn(),
  approveProposal: vi.fn(),
  rejectProposal: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/actions/proposals", () => ({ approveProposal, rejectProposal }));

import { CoworkerEnvelopeApproval } from "./CoworkerEnvelopeApproval";
import { OwnerDecisionCards } from "./OwnerDecisionCards";
import { coworkerEnvelopeToAttentionItem } from "@/lib/attention/sources/coworker-envelope";
import { buildOwnerAttentionProjection } from "@/lib/attention/owner-projection";
import type { AttentionEnvelopeApproval } from "@/lib/attention/types";

const NOW = Date.parse("2026-08-25T20:00:00.000Z");

function approval(over: Partial<AttentionEnvelopeApproval> = {}): AttentionEnvelopeApproval {
  return {
    envelopeId: "cmt932fn301el01p7vfb2gas7",
    coworkerAgentId: "AGT-WS-PORTFOLIO",
    delegatingUserId: "cmt6ejt2109n56mnw5kt1f8y0",
    manifestActionId: "record_initiative_evidence",
    rationale: "This action is authorized to proceed only after employee approval.",
    status: "proposed",
    taskRunId: "TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-7A98D78A3948",
    expiresAtIso: "2026-08-25T20:09:05.868Z",
    actionable: true,
    approveHref: "/api/agent/envelope/cmt932fn301el01p7vfb2gas7/approve",
    declineHref: "/api/agent/envelope/cmt932fn301el01p7vfb2gas7/deny",
    reviewBinding: {
      gate: "research",
      itemId: "BI-MCP-EFF-0285909C",
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      commitSha: "89e875eb49be0604ee8fa4156d0903b6a0932e62",
      path: "docs/superpowers/specs/2026-08-15-resilient-concurrent-development-process.md",
      providerBlobId: "bddca7c5a0b109f9460f84b2b0d886f5d794cbb6",
    },
    ...over,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refresh.mockClear();
  approveProposal.mockClear();
  rejectProposal.mockClear();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CoworkerEnvelopeApproval", () => {
  it("shows the coworker, the requested action, and the reason it is waiting", () => {
    render(<CoworkerEnvelopeApproval approval={approval()} />);

    expect(screen.getByText("AGT-WS-PORTFOLIO")).toBeTruthy();
    expect(screen.getByText("record_initiative_evidence")).toBeTruthy();
    expect(
      screen.getByText("This action is authorized to proceed only after employee approval."),
    ).toBeTruthy();
    expect(screen.getByText("proposed")).toBeTruthy();
  });

  it("shows the task, the expiry, and the whole immutable review binding", () => {
    render(<CoworkerEnvelopeApproval approval={approval()} />);

    expect(
      screen.getByText("TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-7A98D78A3948"),
    ).toBeTruthy();
    expect(screen.getByText("2026-08-25T20:09:05.868Z")).toBeTruthy();
    expect(screen.getByText("BI-MCP-EFF-0285909C")).toBeTruthy();
    expect(screen.getByText("research")).toBeTruthy();
    expect(
      screen.getByText("89e875eb49be0604ee8fa4156d0903b6a0932e62"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "docs/superpowers/specs/2026-08-15-resilient-concurrent-development-process.md",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("bddca7c5a0b109f9460f84b2b0d886f5d794cbb6"),
    ).toBeTruthy();
  });

  it("omits the review binding block when the envelope carries none", () => {
    render(<CoworkerEnvelopeApproval approval={approval({ reviewBinding: undefined })} />);

    expect(screen.queryByText("BI-MCP-EFF-0285909C")).toBeNull();
    expect(screen.queryByText("Reviewed record")).toBeNull();
    expect(screen.getByText("record_initiative_evidence")).toBeTruthy();
  });

  it("approves through the envelope endpoint and never the proposal actions", async () => {
    render(<CoworkerEnvelopeApproval approval={approval()} />);

    fireEvent.click(screen.getByRole("button", { name: "Approve action" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent/envelope/cmt932fn301el01p7vfb2gas7/approve",
      expect.objectContaining({ method: "POST" }),
    );
    expect(approveProposal).not.toHaveBeenCalled();
    expect(rejectProposal).not.toHaveBeenCalled();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("declines through the envelope endpoint and never the proposal actions", async () => {
    render(<CoworkerEnvelopeApproval approval={approval()} />);

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent/envelope/cmt932fn301el01p7vfb2gas7/deny",
      expect.objectContaining({ method: "POST" }),
    );
    expect(rejectProposal).not.toHaveBeenCalled();
  });

  it("sends exactly one request when the button is pressed repeatedly", async () => {
    render(<CoworkerEnvelopeApproval approval={approval()} />);
    const button = screen.getByRole("button", { name: "Approve action" });

    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats an already-settled envelope as settled, not as an error", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Envelope is already in a terminal status (declined).",
        }),
        { status: 409 },
      ),
    );
    render(<CoworkerEnvelopeApproval approval={approval()} />);

    fireEvent.click(screen.getByRole("button", { name: "Approve action" }));

    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(refresh).toHaveBeenCalled();
  });

  it("surfaces the refusal when the envelope belongs to another user", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "delegating user is someone else" }), {
        status: 403,
      }),
    );
    render(<CoworkerEnvelopeApproval approval={approval()} />);

    fireEvent.click(screen.getByRole("button", { name: "Approve action" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Approve action" })).toBeTruthy();
  });

  it.each([
    ["expired", approval({ actionable: false })],
    ["approved", approval({ status: "approved", actionable: false })],
    ["declined", approval({ status: "declined", actionable: false })],
    ["executed", approval({ status: "executed", actionable: false })],
    ["failed", approval({ status: "failed", actionable: false })],
  ])("offers no decision control for a %s envelope", (_label, settled) => {
    render(<CoworkerEnvelopeApproval approval={settled} />);

    expect(screen.queryByRole("button", { name: "Approve action" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
    // The record itself stays readable: hiding a control must not hide evidence.
    expect(screen.getByText("record_initiative_evidence")).toBeTruthy();
  });
});

describe("OwnerDecisionCards routing", () => {
  function entryFor(over = {}) {
    const item = coworkerEnvelopeToAttentionItem(
      {
        id: "cmt932fn301el01p7vfb2gas7",
        coworkerAgentId: "AGT-WS-PORTFOLIO",
        delegatingUserId: "cmt6ejt2109n56mnw5kt1f8y0",
        manifestActionId: "record_initiative_evidence",
        rationale: "This action is authorized to proceed only after employee approval.",
        status: "proposed",
        taskRunId: "TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-7A98D78A3948",
        // clock-bomb-guard: allow projected against the pinned NOW constant, not the wall clock
        expiresAt: new Date("2026-08-25T20:09:05.868Z"),
        createdAt: new Date("2026-08-25T19:54:05.871Z"),
        taskRun: null,
        ...over,
      },
      NOW,
    );
    return buildOwnerAttentionProjection([item], { nowMs: NOW }).needsYouNow[0]!;
  }

  it("renders the envelope approval card, not the proposal controls", async () => {
    render(<OwnerDecisionCards entries={[entryFor()]} />);

    expect(screen.getByText("record_initiative_evidence")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve action" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent/envelope/cmt932fn301el01p7vfb2gas7/approve",
      expect.objectContaining({ method: "POST" }),
    );
    // The AgentActionProposal path must never be reachable from an envelope card.
    expect(approveProposal).not.toHaveBeenCalled();
    expect(rejectProposal).not.toHaveBeenCalled();
  });
});
