// Screen receipts must say WHY a payload classified, not just THAT it did.
//
// A live local-only routing verdict recorded classifiedDataClasses
// ["customer-records","employee-records"] and nothing about what tripped it.
// Diagnosing that took hours of re-deriving the payload by hand — persona,
// tool schemas, business context and full thread history all had to be probed
// separately to find the trigger. The receipt already carried the verdict; it
// just could not explain it.
//
// The hard constraint: provenance must never carry the matched VALUE. A path
// and a rule name locate the source; the value itself is precisely what
// rawPayloadStored:false exists to keep out of the record.

import { describe, expect, it } from "vitest";
import { screenInferencePayload } from "./screen-inference-payload";

const SECRET_EMAIL = "jane.doe@acme-corp.example";
const SECRET_PHONE = "(415) 555-0142";

function screen(systemPrompt: string) {
  return screenInferencePayload({ systemPrompt, messages: [], tools: [] }).receipt;
}

describe("inference screen receipt — match provenance", () => {
  it("records the path, rule and confidence that produced a data class", () => {
    const receipt = screen(`Inbound enquiry from ${SECRET_EMAIL} about catering.`);

    expect(receipt.classifiedDataClasses).toContain("customer-records");
    const provenance = receipt.matchProvenance ?? [];
    expect(provenance.length).toBeGreaterThan(0);

    const match = provenance.find((row) => row.dataClass === "customer-records");
    expect(match).toBeDefined();
    expect(match!.path).toBe("systemPrompt");
    expect(match!.reason).toBe("contact-detail");
    expect(match!.confidence).toBe("deterministic");
  });

  it("NEVER carries the matched value — the receipt stays free of payload text", () => {
    const receipt = screen(`Contact ${SECRET_EMAIL} or ${SECRET_PHONE} for the campaign.`);
    const serialized = JSON.stringify(receipt);

    expect(serialized).not.toContain(SECRET_EMAIL);
    expect(serialized).not.toContain(SECRET_PHONE);
    expect(serialized).not.toContain("jane.doe");
    expect(serialized).not.toContain("555-0142");
    expect(receipt.rawPayloadStored).toBe(false);
  });

  it("distinguishes an inferred escalation from a deterministic one", () => {
    // Generic employment vocabulary escalates on INFERRED confidence alone. That
    // is exactly the case an operator needs to see spelled out before treating a
    // restricted verdict as evidence of real employee data.
    const receipt = screen("Team: 3 employees on the roster; payroll runs monthly.");
    const provenance = receipt.matchProvenance ?? [];

    const employee = provenance.find((row) => row.dataClass === "employee-records");
    expect(employee?.confidence).toBe("inferred");
    expect(employee?.path).toBe("systemPrompt");
  });

  it("emits no provenance for a clean payload", () => {
    const receipt = screen("Campaigns: 0. Pending drafts: 1. Next step: establish one campaign.");

    expect(receipt.classifiedDataClasses).toEqual([]);
    expect(receipt.matchProvenance ?? []).toEqual([]);
  });

  it("collapses repeat hits of the same rule at the same path", () => {
    const receipt = screen(
      `Contacts: a@x.example, b@y.example, c@z.example, d@w.example, e@v.example.`,
    );
    const rows = (receipt.matchProvenance ?? []).filter(
      (row) => row.dataClass === "customer-records" && row.path === "systemPrompt",
    );

    // Five addresses, one rule, one path — one provenance row, not five.
    expect(rows).toHaveLength(1);
  });
});
