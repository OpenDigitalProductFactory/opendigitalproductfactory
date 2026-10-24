import { describe, expect, it } from "vitest";

import {
  buildRecordedResolution,
  planResolution,
  readRecordedResolution,
  summarizeAgreement,
  type AgreementInputRow,
  type ResolvableDecisionRow,
} from "./decision-outcome";

function row(overrides: Partial<ResolvableDecisionRow> = {}): ResolvableDecisionRow {
  return {
    interactionId: "DI-1",
    recommendedOptionId: "a",
    chosenOptionId: null,
    humanOutcome: null,
    options: ["a", "b"],
    autonomous: false,
    ...overrides,
  };
}

describe("planResolution", () => {
  it("records agreement when the actor went with the kernel's pick", () => {
    const outcome = planResolution(row(), { chosenOptionId: "a", resolvedBy: "agent" });

    expect(outcome).toEqual({
      accepted: true,
      disposition: "followed",
      chosenOptionId: "a",
      agreement: true,
      resolvedBy: "agent",
    });
  });

  it("records an override — the labelled correction this corpus exists to collect", () => {
    const outcome = planResolution(row(), { chosenOptionId: "b", resolvedBy: "human" });

    expect(outcome).toEqual({
      accepted: true,
      disposition: "overridden",
      chosenOptionId: "b",
      agreement: false,
      resolvedBy: "human",
    });
  });

  it("treats unresolved as a recorded state with NO agreement signal, not as disagreement", () => {
    const outcome = planResolution(row(), { chosenOptionId: null, resolvedBy: "agent" });

    expect(outcome).toMatchObject({ accepted: true, disposition: "unresolved", agreement: null });
  });

  it("refuses a row the kernel never made a recommendation on", () => {
    // 383 architecture-tradeoff rows deferred. The engine declining to decide is
    // not a recommendation anyone can agree or disagree with.
    const outcome = planResolution(row({ recommendedOptionId: null }), {
      chosenOptionId: "a",
      resolvedBy: "human",
    });

    expect(outcome).toMatchObject({ accepted: false, reason: "no-recommendation" });
  });

  it("refuses to overwrite an outcome already recorded", () => {
    const already = planResolution(row({ chosenOptionId: "b" }), {
      chosenOptionId: "a",
      resolvedBy: "human",
    });
    expect(already).toMatchObject({ accepted: false, reason: "already-resolved" });

    // A humanOutcome with no chosenOptionId is still a recorded outcome — the
    // escalation-hygiene runner withdraws a decision that way, and a later
    // write must not silently land on top of the withdrawal.
    const withdrawn = planResolution(row({ humanOutcome: { type: "withdrawn" } }), {
      chosenOptionId: "a",
      resolvedBy: "human",
    });
    expect(withdrawn).toMatchObject({ accepted: false, reason: "already-resolved" });
  });

  it("refuses an option that was never scored, and names what was on the table", () => {
    const outcome = planResolution(row(), { chosenOptionId: "c", resolvedBy: "human" });

    expect(outcome).toMatchObject({ accepted: false, reason: "option-not-offered" });
    if (outcome.accepted) throw new Error("expected a refusal");
    expect(outcome.detail).toContain('"a"');
    expect(outcome.detail).toContain('"b"');
  });

  it("accepts an outcome on an unattended decision but never on an unrecommended one", () => {
    // `autonomous` classifies the population for the DENOMINATOR; it does not
    // forbid an actor from reporting what it did. Refusing here would make the
    // whole kernel-consult population unreportable, since an agent consulting
    // the kernel is autonomous by definition.
    expect(planResolution(row({ autonomous: true }), { chosenOptionId: "a", resolvedBy: "agent" }))
      .toMatchObject({ accepted: true, disposition: "followed" });
  });
});

describe("readRecordedResolution", () => {
  it("round-trips its own payload", () => {
    const plan = planResolution(row(), { chosenOptionId: "b", resolvedBy: "human" });
    if (!plan.accepted) throw new Error("expected a plan");
    const payload = buildRecordedResolution({
      plan,
      recommendedOptionId: "a",
      rationale: "the kernel scored a cheaper option that loses the audit trail",
      now: new Date("2026-09-22T00:00:00.000Z"),
    });

    expect(readRecordedResolution(payload)).toEqual(payload);
    expect(payload.resolvedAt).toBe("2026-09-22T00:00:00.000Z");
  });

  it("returns null for every other humanOutcome shape on this table", () => {
    // These are the real shapes written by the escalation, org-capture,
    // work-pattern and machine-withdrawal paths. Mistaking one for a
    // resolution would put an unrelated answer into an agreement rate.
    expect(readRecordedResolution({ type: "escalation", answer: "yes" })).toBeNull();
    expect(readRecordedResolution({ type: "work-pattern-review", action: "accept" })).toBeNull();
    expect(readRecordedResolution({ resolvedVia: "resolution-proposal" })).toBeNull();
    expect(readRecordedResolution(null)).toBeNull();
    expect(readRecordedResolution("followed")).toBeNull();
    // Right discriminator, invalid members — still not readable.
    expect(readRecordedResolution({ type: "kernel-consult-resolution", disposition: "ok", resolvedBy: "human" }))
      .toBeNull();
    expect(readRecordedResolution({ type: "kernel-consult-resolution", disposition: "followed", resolvedBy: "cron" }))
      .toBeNull();
  });
});

describe("summarizeAgreement", () => {
  function reported(
    overrides: Partial<AgreementInputRow>,
    resolution: { disposition: "followed" | "overridden" | "unresolved"; resolvedBy: "human" | "agent" },
  ): AgreementInputRow {
    return {
      ...row(overrides),
      resolution: {
        type: "kernel-consult-resolution",
        disposition: resolution.disposition,
        resolvedBy: resolution.resolvedBy,
        recommendedOptionId: "a",
        chosenOptionId: resolution.disposition === "unresolved" ? null : "a",
        agreement: resolution.disposition === "unresolved" ? null : resolution.disposition === "followed",
        rationale: "",
        resolvedAt: "2026-09-22T00:00:00.000Z",
      },
      ...overrides,
    };
  }

  it("never pools a human rate and an agent rate into one number", () => {
    const summary = summarizeAgreement([
      reported({}, { disposition: "followed", resolvedBy: "agent" }),
      reported({}, { disposition: "followed", resolvedBy: "agent" }),
      reported({}, { disposition: "overridden", resolvedBy: "human" }),
    ]);

    expect(summary.byResolver.agent).toMatchObject({ followed: 2, overridden: 0, denominator: 2, rate: 1 });
    expect(summary.byResolver.human).toMatchObject({ followed: 0, overridden: 1, denominator: 1, rate: 0 });
    expect(summary).not.toHaveProperty("rate");
  });

  it("excludes the two ineligible populations by construction and counts them", () => {
    // 513 cron rows nobody attended and 383 rows the engine deferred on. A rate
    // over the whole table would be arithmetic on incomparable things.
    const summary = summarizeAgreement([
      { ...row({ recommendedOptionId: null }), resolution: null },
      { ...row({ autonomous: true }), resolution: null },
      reported({}, { disposition: "followed", resolvedBy: "human" }),
    ]);

    expect(summary.ineligible).toEqual({ noRecommendation: 1, unattended: 1 });
    expect(summary.eligible).toBe(1);
    expect(summary.byResolver.human.denominator).toBe(1);
  });

  it("counts an eligible row nobody reported back on, and never reads silence as agreement", () => {
    const summary = summarizeAgreement([
      { ...row(), resolution: null },
      { ...row(), resolution: null },
      reported({}, { disposition: "followed", resolvedBy: "agent" }),
    ]);

    expect(summary.eligible).toBe(3);
    expect(summary.reported).toBe(1);
    expect(summary.unreported).toBe(2);
    // The rate is over what was reported, and the 2 silent rows are visible
    // beside it rather than folded into the numerator.
    expect(summary.byResolver.agent).toMatchObject({ denominator: 1, rate: 1 });
  });

  it("reports an empty denominator as null, never as zero agreement", () => {
    const summary = summarizeAgreement([{ ...row(), resolution: null }]);

    expect(summary.byResolver.human.rate).toBeNull();
    expect(summary.byResolver.agent.rate).toBeNull();
  });

  it("keeps an unresolved report out of the denominator while still counting it", () => {
    const summary = summarizeAgreement([
      reported({}, { disposition: "unresolved", resolvedBy: "agent" }),
      reported({}, { disposition: "followed", resolvedBy: "agent" }),
    ]);

    expect(summary.reported).toBe(2);
    expect(summary.byResolver.agent).toMatchObject({ unresolved: 1, followed: 1, denominator: 1, rate: 1 });
  });

  it("counts an unattended row as eligible once its actor reports back", () => {
    // An agent consulting the kernel is unattended by construction. What makes
    // its row measurable is that the actor said what it did, not that a human
    // watched.
    const summary = summarizeAgreement([
      reported({ autonomous: true }, { disposition: "overridden", resolvedBy: "agent" }),
    ]);

    expect(summary.ineligible.unattended).toBe(0);
    expect(summary.byResolver.agent).toMatchObject({ overridden: 1, denominator: 1, rate: 0 });
  });
});
