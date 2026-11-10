// BI-EBE25715 — an address carried as authorship metadata is not a customer
// contact record.
//
// Live failure this pins: a Build Studio code-gen turn was classified
// `customer-records` (deterministic, reason `contact-detail`) purely because the
// payload embedded commit history. That escalated declaredSensitivity `internal`
// to measuredSensitivity `confidential`, the vertical customer-records pack
// returned `policyEffect: "deny"`, screening set `routeEffect: "local-only"`,
// and routing then excluded every cloud endpoint with "Residency policy
// 'local_only' requires a local provider". The turn died whenever local-CI held
// the host capacity reservation, while eligible cloud models sat idle.
import { describe, expect, it } from "vitest";

import { classifyInferencePayload } from "./classify-payload";

function classify(text: string) {
  return classifyInferencePayload({
    systemPrompt: "",
    messages: [{ role: "user", content: text }],
  } as Parameters<typeof classifyInferencePayload>[0]);
}

const contactMatches = (text: string) =>
  classify(text).matches.filter((m) => m.reason === "contact-detail");

describe("contact-detail exempts authorship metadata (BI-EBE25715)", () => {
  it("does not classify a DCO sign-off as a customer record", () => {
    expect(contactMatches("Signed-off-by: Mark Bodman <markdbodman@gmail.com>")).toHaveLength(0);
  });

  it("does not classify a Co-Authored-By trailer as a customer record", () => {
    expect(
      contactMatches("Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"),
    ).toHaveLength(0);
  });

  it("does not classify a noreply address as a customer record", () => {
    expect(contactMatches("mail sent from <no-reply@example.com>")).toHaveLength(0);
  });

  it("does not classify the acting account identifier as a customer record", () => {
    expect(contactMatches("createdById: admin@dpf.local")).toHaveLength(0);
  });

  it("STILL classifies a bare address that is not authorship metadata", () => {
    expect(contactMatches("the customer wrote in from jane.doe@acme.com")).toHaveLength(1);
  });

  it("STILL classifies a real address that appears alongside a trailer", () => {
    const text = [
      "Signed-off-by: Mark Bodman <markdbodman@gmail.com>",
      "Customer contact: jane.doe@acme.com",
    ].join("\n");
    expect(contactMatches(text)).toHaveLength(1);
  });

  it("STILL classifies a phone number — the exemption is email-shaped only", () => {
    expect(contactMatches("reach them on 415-555-0132")).toHaveLength(1);
  });

  it("leaves a payload with no contact detail alone", () => {
    expect(
      contactMatches("gate-worktree.mjs:1556 assigns summarizeLocalCiOutput to failureSummary"),
    ).toHaveLength(0);
  });
});
