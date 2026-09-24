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
import { summarizeCoworkerEnvelopeDecision } from "@/lib/attention/coworker-envelope-decision";
import { buildOwnerAttentionProjection } from "@/lib/attention/owner-projection";
import type { AttentionEnvelopeApproval } from "@/lib/attention/types";

const NOW = Date.parse("2026-08-25T20:00:00.000Z");

function approval(over: Partial<AttentionEnvelopeApproval> = {}): AttentionEnvelopeApproval {
  const reviewBinding = Object.prototype.hasOwnProperty.call(over, "reviewBinding")
    ? over.reviewBinding
    : {
        gate: "research",
        itemId: "BI-MCP-EFF-0285909C",
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        commitSha: "89e875eb49be0604ee8fa4156d0903b6a0932e62",
        path: "docs/superpowers/specs/2026-08-15-resilient-concurrent-development-process.md",
        providerBlobId: "bddca7c5a0b109f9460f84b2b0d886f5d794cbb6",
      };
  const base: AttentionEnvelopeApproval = {
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
    decision: summarizeCoworkerEnvelopeDecision({
      toolName: "record_initiative_evidence",
      proposedParameters: { decision: "pass" },
      reviewBinding: reviewBinding
        ? { gate: reviewBinding.gate, itemId: reviewBinding.itemId }
        : undefined,
      recommenderAgentId: "AGT-WS-PORTFOLIO",
      authorizerUserId: "cmt6ejt2109n56mnw5kt1f8y0",
    }),
    ...(reviewBinding ? { reviewBinding } : {}),
  };
  return { ...base, ...over, decision: over.decision ?? base.decision };
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
  it("states the AI recommendation versus human authorization, not identity plumbing", () => {
    render(<CoworkerEnvelopeApproval approval={approval()} />);

    expect(screen.getByText("Human authorization needed")).toBeTruthy();
    expect(
      screen.getByText("record that receipt so implementation planning may continue."),
    ).toBeTruthy();
    expect(screen.getByText("BI-MCP-EFF-0285909C")).toBeTruthy();
    expect(screen.getByText("research")).toBeTruthy();
    expect(screen.getByText("pass")).toBeTruthy();
    expect(screen.getByText("None")).toBeTruthy();
    expect(screen.getByText("Your coworker")).toBeTruthy();
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.queryByText("AGT-WS-PORTFOLIO")).toBeNull();
    expect(screen.queryByText("record_initiative_evidence")).toBeNull();
    expect(screen.queryByText("proposed")).toBeNull();
    expect(
      screen.queryByText("TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-7A98D78A3948"),
    ).toBeNull();
    expect(
      screen.queryByText("89e875eb49be0604ee8fa4156d0903b6a0932e62"),
    ).toBeNull();
    expect(screen.queryByText("bddca7c5a0b109f9460f84b2b0d886f5d794cbb6")).toBeNull();
    expect(screen.getByRole("button", { name: "Authorize" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve action" })).toBeNull();
  });

  it("lists findings on a fail without calling the stages approval", () => {
    render(
      <CoworkerEnvelopeApproval
        approval={approval({
          decision: summarizeCoworkerEnvelopeDecision({
            toolName: "record_initiative_evidence",
            proposedParameters: {
              decision: "fail",
              findings: [{ issue: "The defect was not reproduced.", severity: "critical" }],
            },
            reviewBinding: { gate: "research", itemId: "BI-MCP-EFF-0285909C" },
            recommenderAgentId: "AGT-WS-PORTFOLIO",
            authorizerUserId: "cmt6ejt2109n56mnw5kt1f8y0",
          }),
        })}
      />,
    );

    expect(screen.getByText("The defect was not reproduced.")).toBeTruthy();
    expect(screen.getByText("fail")).toBeTruthy();
    expect(screen.queryByText(/approv/i)).toBeNull();
  });

  it("omits subject and gate when the envelope carries no bound record", () => {
    render(<CoworkerEnvelopeApproval approval={approval({ reviewBinding: undefined })} />);

    expect(screen.queryByText("BI-MCP-EFF-0285909C")).toBeNull();
    expect(screen.getByText("Human authorization needed")).toBeTruthy();
  });

  it("approves through the envelope endpoint and never the proposal actions", async () => {
    render(<CoworkerEnvelopeApproval approval={approval()} />);

    fireEvent.click(screen.getByRole("button", { name: "Authorize" }));

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
    const button = screen.getByRole("button", { name: "Authorize" });

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

    fireEvent.click(screen.getByRole("button", { name: "Authorize" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Authorize" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Authorize" })).toBeTruthy();
  });

  it.each([
    ["expired", approval({ actionable: false })],
    ["approved", approval({ status: "approved", actionable: false })],
    ["declined", approval({ status: "declined", actionable: false })],
    ["executed", approval({ status: "executed", actionable: false })],
    ["failed", approval({ status: "failed", actionable: false })],
  ])("offers no decision control for a %s envelope", (_label, settled) => {
    render(<CoworkerEnvelopeApproval approval={settled} />);

    expect(screen.queryByRole("button", { name: "Authorize" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
    // The record itself stays readable: hiding a control must not hide evidence.
    expect(screen.getByText("Human authorization needed")).toBeTruthy();
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
        proposedParameters: { decision: "pass" },
        taskRun: {
          a2aMetadata: {
            initiativeReviewBinding: {
              gate: "research",
              itemId: "BI-MCP-EFF-0285909C",
              writerToolName: "record_initiative_evidence",
              artifactRef: {
                kind: "repo-blob-at-commit",
                repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
                commitSha: "89e875eb49be0604ee8fa4156d0903b6a0932e62",
                path: "docs/superpowers/specs/2026-08-15-resilient-concurrent-development-process.md",
                providerBlobId: "bddca7c5a0b109f9460f84b2b0d886f5d794cbb6",
              },
            },
          },
        },
        ...over,
      },
      NOW,
    );
    return buildOwnerAttentionProjection([item], { nowMs: NOW }).needsYouNow[0]!;
  }

  it("renders the envelope approval card, not the proposal controls", async () => {
    render(<OwnerDecisionCards entries={[entryFor()]} />);

    expect(screen.getByText("Authorize this research receipt?")).toBeTruthy();
    expect(screen.getByText(/research passes with no findings/i)).toBeTruthy();
    expect(screen.getByText("Human authorization needed")).toBeTruthy();
    expect(screen.queryByText("record_initiative_evidence")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Authorize" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent/envelope/cmt932fn301el01p7vfb2gas7/approve",
      expect.objectContaining({ method: "POST" }),
    );
    // The AgentActionProposal path must never be reachable from an envelope card.
    expect(approveProposal).not.toHaveBeenCalled();
    expect(rejectProposal).not.toHaveBeenCalled();
  });

  it("keeps identity plumbing under technical detail", () => {
    render(<OwnerDecisionCards entries={[entryFor()]} />);

    expect(screen.queryByText("record_initiative_evidence")).toBeNull();
    expect(
      screen.queryByText("89e875eb49be0604ee8fa4156d0903b6a0932e62"),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Technical detail/ }));

    expect(screen.getByText("record_initiative_evidence")).toBeTruthy();
    expect(
      screen.getByText("89e875eb49be0604ee8fa4156d0903b6a0932e62"),
    ).toBeTruthy();
    expect(screen.getByText("bddca7c5a0b109f9460f84b2b0d886f5d794cbb6")).toBeTruthy();
  });
});

describe("CoworkerEnvelopeApproval — exact effect (BI-12E5DD91)", () => {
  const evidence = () =>
    approval({
      coworkerAgentId: "AGT-EXT-CODEX",
      manifestActionId: "record_workroom_evidence",
      taskRunId: null,
      reviewBinding: undefined,
      decision: summarizeCoworkerEnvelopeDecision({
        toolName: "record_workroom_evidence",
        proposedParameters: { capsuleId: "WC-04ED087E", kind: "note", summary: "Acceptance A." },
        recommenderAgentId: "AGT-EXT-CODEX",
        authorizerUserId: "cmt6ejt2109n56mnw5kt1f8y0",
        rationale: "Rule. It changes a record, and no recorded delegation, room decision, schedule or independent review covers it.",
      }),
    });

  it("shows action, destination, proposed content, consequence, reason, scope and status", () => {
    render(<CoworkerEnvelopeApproval approval={evidence()} />);
    expect(screen.getByText("Add an evidence entry to a Workroom timeline")).toBeTruthy();
    expect(screen.getAllByText("Workroom WC-04ED087E").length).toBeGreaterThan(0);
    expect(screen.getByText("Proposed content")).toBeTruthy();
    expect(screen.getByText("Acceptance A.")).toBeTruthy();
    expect(screen.getByText(/None declared/)).toBeTruthy();
    expect(screen.getByText(/no recorded delegation/)).toBeTruthy();
    expect(screen.getByText(/does not review the content/)).toBeTruthy();
    expect(screen.getByText("Waiting for your decision")).toBeTruthy();
    expect(screen.queryByText("Findings")).toBeNull();
  });

  it("says what happened to the change after authorizing, never done when nothing ran", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, execution: { status: "executed", message: "ok" } }), { status: 200 }));
    render(<CoworkerEnvelopeApproval approval={evidence()} />);
    fireEvent.click(screen.getByText("Authorize"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Authorized and done."));
    cleanup();

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, execution: { status: "not-run", message: "The approval window closed before it could run." } }), { status: 200 }));
    render(<CoworkerEnvelopeApproval approval={evidence()} />);
    fireEvent.click(screen.getByText("Authorize"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Nothing has been written yet\. The approval window closed/));
    cleanup();

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, execution: { status: "failed", message: "room refused" } }), { status: 200 }));
    render(<CoworkerEnvelopeApproval approval={evidence()} />);
    fireEvent.click(screen.getByText("Authorize"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/did not complete: room refused/));
  });

  it("marks an unloadable proposal as unresolved instead of offering a generic record", () => {
    render(
      <CoworkerEnvelopeApproval
        approval={approval({
          reviewBinding: undefined,
          decision: summarizeCoworkerEnvelopeDecision({
            toolName: "record_runtime_verification",
            proposedParameters: undefined,
            recommenderAgentId: "AGT-EXT-CODEX",
            authorizerUserId: "cmt6ejt2109n56mnw5kt1f8y0",
          }),
        })}
      />,
    );
    expect(screen.getByRole("note").textContent).toMatch(/could not be loaded/);
    expect(screen.getByText(/decline unless you already know/)).toBeTruthy();
  });

  it("shows an expired window as closed with its persisted status", () => {
    render(<CoworkerEnvelopeApproval approval={{ ...evidence(), actionable: false }} />);
    expect(screen.getByText("Closed: the window expired")).toBeTruthy();
    expect(screen.queryByText("Authorize")).toBeNull();
  });
});

describe("CoworkerEnvelopeApproval — lapsed window (BI-12E5DD91)", () => {
  it("says the request expired when the window closed before the decision reached the server", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      error: "This request's decision window closed before it was answered, so it has expired. Your coworker can ask again.",
    }), { status: 409 }));
    render(<CoworkerEnvelopeApproval approval={approval()} />);
    fireEvent.click(screen.getByText("Authorize"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/has expired/));
  });
});
