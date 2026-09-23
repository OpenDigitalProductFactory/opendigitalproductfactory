import { describe, expect, it } from "vitest";

import {
  buildLedgerSummary,
  planFindingContribution,
  readEscalationOutcome,
  type ContributableProposal,
} from "./finding-contribution";

function proposal(overrides: Partial<ContributableProposal> = {}): ContributableProposal {
  return {
    proposalId: "IP-A1B2C",
    title: "The async worker throws before claiming, so recovery re-enqueues forever",
    contributionStatus: "local",
    backlogItemId: "cmt6ejwk00ame6mnwjfcudv6t",
    ...overrides,
  };
}

describe("planFindingContribution", () => {
  it("lets a local finding with a filed item through", () => {
    expect(planFindingContribution(proposal(), "IP-A1B2C")).toEqual({
      eligible: true,
      proposalId: "IP-A1B2C",
      backlogItemId: "cmt6ejwk00ame6mnwjfcudv6t",
    });
  });

  it("refuses a second send rather than treating it as a no-op", () => {
    // A no-op would read as "it worked" to a caller retrying after an earlier
    // ambiguous result, and a real second send files a duplicate upstream under
    // this install's pseudonym.
    const outcome = planFindingContribution(
      proposal({ contributionStatus: "contributed" }),
      "IP-A1B2C",
    );

    expect(outcome).toMatchObject({ eligible: false, reason: "already-contributed" });
    if (outcome.eligible) throw new Error("expected a refusal");
    expect(outcome.detail).toContain("duplicate");
  });

  it("refuses a proposal with no backlog item and says which case that is", () => {
    // propose_improvement suppresses the item for a low-severity reference-doc
    // note on purpose; those are batched by the canonical digest instead. The
    // caller needs to know that rather than think the platform lost the finding.
    const outcome = planFindingContribution(proposal({ backlogItemId: null }), "IP-A1B2C");

    expect(outcome).toMatchObject({ eligible: false, reason: "no-backlog-item" });
    if (outcome.eligible) throw new Error("expected a refusal");
    expect(outcome.detail).toContain("reference-doc");
  });

  it("refuses an unknown id without inventing one", () => {
    expect(planFindingContribution(null, "IP-NOPE")).toMatchObject({
      eligible: false,
      reason: "not-found",
    });
  });

  it("treats any status other than contributed as still local", () => {
    // The column defaults to "local" but is a free-text string. An unexpected
    // value must not be read as "already left the install".
    for (const status of ["local", "", "pending", "queued"]) {
      expect(planFindingContribution(proposal({ contributionStatus: status }), "IP-A1B2C").eligible)
        .toBe(true);
    }
  });
});

describe("readEscalationOutcome", () => {
  const p = { proposalId: "IP-A1B2C", title: "A durable finding" };

  it("reports a filed escalation as contributed, carrying where it went", () => {
    const result = readEscalationOutcome(
      { status: "filed", issueNumber: 42, url: "https://example.invalid/issues/42" },
      p,
    );

    expect(result).toMatchObject({ contributed: true, issueNumber: 42 });
    if (!result.contributed) throw new Error("expected a contribution");
    expect(result.ledgerSummary).toContain("IP-A1B2C");
    expect(result.ledgerSummary).toContain("https://example.invalid/issues/42");
  });

  it("passes a skip reason through verbatim instead of calling it a failure", () => {
    // "This install keeps everything on your own system" is a CORRECT answer.
    // Reporting it as a failure would tell an operator their finding was lost.
    const result = readEscalationOutcome(
      { status: "skipped", reason: "install is private — no upstream escalation" },
      p,
    );

    expect(result).toMatchObject({ contributed: false, reason: "escalation-refused" });
    if (result.contributed) throw new Error("expected a refusal");
    expect(result.detail).toContain("install is private");
    expect(result.detail).not.toContain("failed");
  });

  it("distinguishes a real failure from a skip", () => {
    const result = readEscalationOutcome({ status: "failed", error: "upstream unreachable" }, p);

    expect(result).toMatchObject({ contributed: false });
    if (result.contributed) throw new Error("expected a refusal");
    expect(result.detail).toContain("failed");
    expect(result.detail).toContain("upstream unreachable");
  });
});

describe("buildLedgerSummary", () => {
  const p = { proposalId: "IP-A1B2C", title: "A durable finding" };

  it("names the proposal and the title, so the ledger row is readable alone", () => {
    const summary = buildLedgerSummary(p, { status: "filed", issueNumber: 7, url: "https://u/7" });
    expect(summary).toContain("IP-A1B2C");
    expect(summary).toContain("A durable finding");
  });

  it("degrades to the issue number, then to a word, when there is no url", () => {
    expect(buildLedgerSummary(p, { status: "filed", issueNumber: 7, url: null })).toContain("issue #7");
    expect(buildLedgerSummary(p, { status: "filed", issueNumber: null, url: null })).toContain("upstream");
  });
});
