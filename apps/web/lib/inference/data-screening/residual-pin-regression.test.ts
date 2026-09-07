// Regression lock for three coworker-pinning defects that are FIXED on main.
//
// BI-88247CE2, BI-3F608240 and BI-463BE12A were each filed as "this phrase
// pins a coworker thread to restricted forever". Each was fixed by a different
// change — ambiguous-term corroboration, tool-argument key handling, and
// instruction-span provenance — and none had a test that would fail if the fix
// were undone. Re-verified against eee67781a before writing this file: all
// three now route `allow`.
//
// They are locked here together because they share one failure shape: ordinary
// business vocabulary, in a place the operator did not choose, silently costing
// a coworker its cloud model. A regression in any of them reads to the operator
// as "the COO got dumber again", which is exactly the report that opened this
// whole line of work — and is close to undiagnosable from the symptom.

import { describe, expect, it } from "vitest";
import { screenInferencePayload } from "./screen-inference-payload";

describe("residual coworker-pin regressions", () => {
  it("BI-88247CE2: 'payroll' as a SaaS spend category does not pin the thread", () => {
    // One ambiguous term, uncorroborated. Restricting on this stranded a live
    // COO thread for days; corroboration now requires a second distinct reason.
    const receipt = screenInferencePayload({
      systemPrompt: "You are the COO.",
      messages: [{
        role: "user",
        content: "Our SaaS categories are CRM, payroll, analytics and helpdesk. Which should we consolidate?",
      }],
      tools: [],
    }).receipt;

    expect(receipt.measuredSensitivity).not.toBe("restricted");
    expect(receipt.routeEffect).toBe("allow");
  });

  it("BI-3F608240: a tool argument NAMED 'discipline' does not pin the turn", () => {
    // The KEY, not the value, was matching. A schema field name is authored by
    // the platform, never by the operator, so it can never be edited away.
    const receipt = screenInferencePayload({
      systemPrompt: "You are the COO.",
      messages: [
        {
          role: "assistant",
          content: "",
          toolCalls: [{
            name: "search_knowledge",
            arguments: JSON.stringify({ discipline: "architecture", query: "north star" }),
          }],
        } as never,
        { role: "user", content: "What is our north star?" },
      ],
      tools: [],
    }).receipt;

    expect(receipt.measuredSensitivity).not.toBe("restricted");
    expect(receipt.routeEffect).toBe("allow");
  });

  it("BI-463BE12A: a persona that names payroll and invoices does not pin the coworker", () => {
    // The coworker's OWN job description trapped it: every COO, HR and finance
    // coworker was restricted on every turn, forever, by text it never chose.
    const persona = "You are the COO. You oversee payroll, invoices and vendor spend for the company.";
    const ask = { role: "user" as const, content: "What is on the agenda today?" };

    const undeclared = screenInferencePayload({
      systemPrompt: persona,
      messages: [ask],
      tools: [],
    }).receipt;
    expect(undeclared.routeEffect).toBe("allow");

    // Declaring the persona as instruction is strictly stronger: the match is
    // still recorded for the receipt, but sets no floor at all.
    const declared = screenInferencePayload({
      systemPrompt: persona,
      systemPromptInstructionSpans: [persona],
      messages: [ask],
      tools: [],
    }).receipt;
    expect(declared.measuredSensitivity).toBe("internal");
    expect(declared.routeEffect).toBe("allow");
    expect(
      (declared.matchProvenance ?? []).some((row) => row.path.startsWith("systemPrompt.instruction[")),
    ).toBe(true);
  });
});
