import { describe, expect, it, vi } from "vitest";

import { applyAcceptedProposal, type WriteThroughDeps } from "./resolution-write-through";

function deps(overrides: Partial<WriteThroughDeps> = {}): WriteThroughDeps {
  return {
    captureAnswer: vi.fn(async () => ({ draftCount: 2 })),
    adoptOption: vi.fn(async () => {}),
    ruleWeight: vi.fn(async () => ({ applied: true })),
    recordNoChange: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("applyAcceptedProposal", () => {
  it("routes an answer through the org-corpus capture path and says it landed as draft", async () => {
    const d = deps();
    const result = await applyAcceptedProposal(d, {
      actionKind: "answer_gap",
      payload: { question: "Do we ingest third-party catalogs?", answer: "Not without a DPA." },
      interactionRowId: "row-1",
    });
    expect(result).toEqual({
      ok: true,
      data: "Captured. 2 draft page(s) await your review before they become authoritative.",
    });
    expect(d.captureAnswer).toHaveBeenCalledWith({
      question: "Do we ingest third-party catalogs?",
      answer: "Not without a DPA.",
    });
  });

  it("does not claim knowledge was captured when nothing could be extracted", async () => {
    const result = await applyAcceptedProposal(deps({ captureAnswer: async () => ({ draftCount: 0 }) }), {
      actionKind: "answer_gap",
      payload: { question: "q", answer: "a" },
      interactionRowId: "row-1",
    });
    expect(result).toMatchObject({ ok: true });
    expect(result).not.toMatchObject({ data: expect.stringContaining("await your review") });
  });

  it("refuses an answer missing its question or its text", async () => {
    const d = deps();
    expect(
      await applyAcceptedProposal(d, {
        actionKind: "answer_gap",
        payload: { question: "q", answer: "   " },
        interactionRowId: "row-1",
      }),
    ).toMatchObject({ ok: false });
    expect(d.captureAnswer).not.toHaveBeenCalled();
  });

  it("records an adopted option against its decision", async () => {
    const d = deps();
    const result = await applyAcceptedProposal(d, {
      actionKind: "adopt_option",
      payload: { optionId: "decline" },
      interactionRowId: "row-1",
      note: "Not until the agreement is signed.",
    });
    expect(result).toMatchObject({ ok: true });
    expect(d.adoptOption).toHaveBeenCalledWith({
      interactionRowId: "row-1",
      optionId: "decline",
      note: "Not until the agreement is signed.",
    });
  });

  it("refuses to adopt an option with no decision to attach it to", async () => {
    const d = deps();
    expect(
      await applyAcceptedProposal(d, {
        actionKind: "adopt_option",
        payload: { optionId: "proceed" },
        interactionRowId: null,
      }),
    ).toMatchObject({ ok: false });
    expect(d.adoptOption).not.toHaveBeenCalled();
  });

  it("passes a weight adjustment to the existing ruling path and surfaces its refusal", async () => {
    const failing = deps({ ruleWeight: async () => ({ applied: false, error: "Someone already ruled on this." }) });
    expect(
      await applyAcceptedProposal(failing, {
        actionKind: "adjust_weight",
        payload: { weightProposalId: "wap:1" },
        interactionRowId: null,
      }),
    ).toEqual({ ok: false, error: "Someone already ruled on this." });
  });

  it("makes a no-change ruling say why", async () => {
    const d = deps();
    expect(
      await applyAcceptedProposal(d, {
        actionKind: "no_change",
        payload: {},
        interactionRowId: "row-1",
      }),
    ).toMatchObject({ ok: false });
    expect(d.recordNoChange).not.toHaveBeenCalled();

    expect(
      await applyAcceptedProposal(d, {
        actionKind: "no_change",
        payload: { reason: "The vendor policy already covers this." },
        interactionRowId: "row-1",
      }),
    ).toMatchObject({ ok: true });
  });

  it("refuses an action kind whose write path is not wired, rather than reporting a silent success", async () => {
    for (const actionKind of ["amend_stance", "release_material"] as const) {
      const result = await applyAcceptedProposal(deps(), {
        actionKind,
        payload: { slug: "some-page" },
        interactionRowId: "row-1",
      });
      expect(result.ok).toBe(false);
    }
  });
});
