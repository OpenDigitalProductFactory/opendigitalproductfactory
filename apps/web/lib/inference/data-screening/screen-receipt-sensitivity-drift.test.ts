// A receipt must say whether its sensitivity came from the PAYLOAD or from the
// route's DECLARED label.
//
// route-context-map.ts declares a static sensitivity per route, and
// screenInferencePayload treats it as a floor: strongestSensitivity(declared,
// measured). So a route labelled `confidential` routes as confidential even
// when the payload it assembles measures `internal` with zero data classes.
//
// Live 2026-08-01, /customer/marketing: every assembled tier — persona, tool
// schemas, business context, page data, thread history, user facts,
// profession-corpus — classified internal with NO data classes, yet the turn
// ran at confidential. That excluded 11 cloud endpoints for "Sensitivity
// clearance missing for 'confidential'", pinned residency local_only, and left
// exactly one ranked candidate whose fallbackChain referenced only itself. The
// coworker then failed, and the user-facing message blamed the provider.
//
// The receipt recorded the resulting sensitivity and nothing about which side
// produced it, so the label was indistinguishable from a genuine payload
// finding. Recording both makes declared-vs-measured drift observable from real
// traffic instead of re-derivable only by hand.
//
// Same constraint as match provenance: these are LEVELS, never payload values,
// so rawPayloadStored stays false.

import { describe, expect, it } from "vitest";
import { screenInferencePayload } from "./screen-inference-payload";

describe("inference screen receipt — declared vs measured sensitivity", () => {
  it("records that a clean payload was raised by the route's declared label", () => {
    // The shape of a real /customer/marketing turn: campaign state only, no
    // contact details, no employment vocabulary.
    const receipt = screenInferencePayload({
      systemPrompt:
        "Marketing workspace. Campaigns: 3 drafts, 1 scheduled. Pipeline: 4 open, 2 closed.",
      messages: [],
      tools: [],
      routeContext: { sensitivity: "confidential" },
    }).receipt;

    expect(receipt.classifiedDataClasses).toEqual([]);
    expect(receipt.measuredSensitivity).toBe("internal");
    expect(receipt.declaredSensitivity).toBe("confidential");
    // The declaration, not the payload, is what raised this turn.
    expect(receipt.sensitivityFloorApplied).toBe(true);
  });

  it("does not flag a floor when the payload itself justifies the level", () => {
    const receipt = screenInferencePayload({
      systemPrompt: "Inbound enquiry from jane.doe@acme-corp.example about catering.",
      messages: [],
      tools: [],
      routeContext: { sensitivity: "internal" },
    }).receipt;

    expect(receipt.classifiedDataClasses).toContain("customer-records");
    // Measured meets or exceeds the declaration, so nothing was raised by label.
    expect(receipt.sensitivityFloorApplied).toBe(false);
    expect(receipt.declaredSensitivity).toBe("internal");
  });

  it("reports both levels even when no route context is supplied", () => {
    const receipt = screenInferencePayload({
      systemPrompt: "Draft a campaign brief for the autumn menu.",
      messages: [],
      tools: [],
    }).receipt;

    expect(receipt.measuredSensitivity).toBe("internal");
    expect(receipt.sensitivityFloorApplied).toBe(false);
  });

  it("keeps the receipt free of payload text", () => {
    const receipt = screenInferencePayload({
      systemPrompt: "Contact jane.doe@acme-corp.example for the campaign.",
      messages: [],
      tools: [],
      routeContext: { sensitivity: "restricted" },
    }).receipt;

    expect(receipt.rawPayloadStored).toBe(false);
    expect(JSON.stringify(receipt)).not.toContain("jane.doe@acme-corp.example");
  });
});
