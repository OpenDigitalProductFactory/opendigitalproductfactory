import { describe, expect, it } from "vitest";

import { classifyInferencePayload } from "./classify-payload";
import type { ChatMessage } from "@/lib/inference/ai-inference";

describe("classifyInferencePayload", () => {
  it("detects secrets, customer, employee, finance, and source-code data without echoing raw values", () => {
    const providerKeyCanary = ["sk", "test", "1234567890abcdef"].join("-");
    const mcpTokenCanary = ["dpfmcp", "secret", "1234567890"].join("_");
    const messages: ChatMessage[] = [
      {
        role: "user",
        content:
          "Please debug this customer issue for pat@example.com. " +
          `Employee salary is 125000 and the Stripe key is ${providerKeyCanary}.`,
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will inspect the JavaScript snippet." },
          {
            type: "tool_use",
            id: "tool-1",
            name: "inspect_code",
            input: {
              source: `const token = '${mcpTokenCanary}';`,
              routingNumber: "021000021",
            },
          },
        ],
      },
    ];

    const result = classifyInferencePayload({
      messages,
      systemPrompt: "You are helping with customer support and payroll triage.",
      tools: [
        {
          type: "function",
          function: {
            name: "lookupCustomer",
            description: "Look up customer payment and support records.",
          },
        },
      ],
      taskType: "tool-action",
    });

    expect(result.overallSensitivity).toBe("restricted");
    expect(result.dataClasses).toEqual([
      "customer-records",
      "employee-records",
      "payments-finance",
      "secrets-credentials",
      "source-code",
    ]);
    expect(result.receipt.rawPayloadStored).toBe(false);
    expect(result.receipt.detectedClasses).toEqual(result.dataClasses);
    expect(result.matches.map((match) => match.dataClass)).toEqual(
      expect.arrayContaining([
        "customer-records",
        "employee-records",
        "payments-finance",
        "secrets-credentials",
        "source-code",
      ]),
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("pat@example.com");
    expect(serialized).not.toContain(providerKeyCanary);
    expect(serialized).not.toContain(mcpTokenCanary);
    expect(serialized).not.toContain("021000021");
  });

  it("adds unknown-governed-data when governed classification is missing", () => {
    const result = classifyInferencePayload({
      messages: [{ role: "user", content: "Summarize the attached governed export." }],
      systemPrompt: "",
      taskType: "summarization",
      governedData: [
        {
          assetId: "asset-customer-export",
          classificationKnown: false,
          purpose: "coworker-assistance",
        },
      ],
    });

    expect(result.overallSensitivity).toBe("restricted");
    expect(result.dataClasses).toContain("unknown-governed-data");
    expect(result.matches).toContainEqual(
      expect.objectContaining({
        dataClass: "unknown-governed-data",
        path: "governedData[0]",
        reason: "governed-classification-missing",
      }),
    );
    expect(JSON.stringify(result)).not.toContain("asset-customer-export");
  });

  it("returns a stable low-risk receipt for benign internal work", () => {
    const result = classifyInferencePayload({
      messages: [{ role: "user", content: "Draft a friendly announcement about next week's team lunch." }],
      systemPrompt: "Be concise.",
      taskType: "creative",
    });

    expect(result.overallSensitivity).toBe("internal");
    expect(result.dataClasses).toEqual([]);
    expect(result.matches).toEqual([]);
    expect(result.receipt).toEqual(
      expect.objectContaining({
        rawPayloadStored: false,
        detectedClasses: [],
        matchCount: 0,
        transformation: "none",
      }),
    );
    expect(result.receipt.inputHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not mistake instruction vocabulary or ordinary prose for live governed data", () => {
    const result = classifyInferencePayload({
      messages: [
        {
          role: "user",
          content:
            "Certification probe. Use a read-only tool, then let me know what evidence you found.",
        },
      ],
      systemPrompt:
        "You help an employee understand the platform. " +
        "Let me know when the review is complete and explain which class is responsible.",
      taskType: "conversation",
    });

    expect(result.overallSensitivity).toBe("internal");
    expect(result.dataClasses).toEqual([]);
    expect(result.matches).toEqual([]);
  });

  it("hashes tool declarations without treating their schema vocabulary as live data", () => {
    const withSensitiveSchemaNames = classifyInferencePayload({
      messages: [{ role: "user", content: "Check whether the workspace is ready." }],
      systemPrompt: "Use an appropriate read-only tool.",
      tools: [{
        type: "function",
        function: {
          name: "inspect_employee_record",
          description: "Inspect payment, credential, and customer record metadata.",
          parameters: {
            type: "object",
            properties: {
              password: { type: "string" },
              employeeEmail: { type: "string" },
            },
          },
        },
      }],
      taskType: "conversation",
    });
    const withoutTools = classifyInferencePayload({
      messages: [{ role: "user", content: "Check whether the workspace is ready." }],
      systemPrompt: "Use an appropriate read-only tool.",
      taskType: "conversation",
    });

    expect(withSensitiveSchemaNames.overallSensitivity).toBe("internal");
    expect(withSensitiveSchemaNames.dataClasses).toEqual([]);
    expect(withSensitiveSchemaNames.matches).toEqual([]);
    expect(withSensitiveSchemaNames.receipt.inputHash).not.toBe(
      withoutTools.receipt.inputHash,
    );
  });

  it("continues to classify sensitive values in executed tool-call arguments", () => {
    const result = classifyInferencePayload({
      messages: [{
        role: "assistant",
        content: "",
        toolCalls: [{
          id: "call-1",
          name: "lookup",
          arguments: { password: "not-a-real-value" },
        }],
      }],
      systemPrompt: "",
      taskType: "conversation",
    });

    expect(result.overallSensitivity).toBe("restricted");
    expect(result.dataClasses).toContain("secrets-credentials");
    expect(result.matches).toContainEqual(expect.objectContaining({
      path: "messages[0].toolCalls[0].arguments.password",
      reason: "secret-field-name",
    }));
  });

  it.each([
    ["health-phi", "patientDiagnosis", "Type 1 diabetes"],
    ["payments-finance", "bankAccountNumber", "000123456789"],
    ["legal-privileged", "attorneyClientPrivilege", "litigation strategy"],
    ["criminal-justice", "criminalJusticeInformation", "NCIC criminal history"],
    ["safety-sensitive", "threatAssessment", "protected shelter location"],
    ["youth-sensitive", "parentalConsent", "child under 13"],
    ["employee-records", "employeeDiscipline", "manager-only note"],
    ["source-code", "sourceCode", "export function privateHandler() {}"],
    ["secrets-credentials", "accessToken", "not-a-real-credential"],
    ["customer-records", "customerEmail", "case-owner@example.test"],
  ] as const)(
    "detects the %s acceptance fixture without retaining its value",
    (dataClass, field, value) => {
      const result = classifyInferencePayload({
        messages: [{
          role: "assistant",
          content: "",
          toolCalls: [{
            id: "call-regulated-fixture",
            name: "inspect_governed_record",
            arguments: { [field]: value },
          }],
        }],
        systemPrompt: "",
        taskType: "tool-action",
      });

      expect(result.dataClasses).toContain(dataClass);
      expect(JSON.stringify(result)).not.toContain(value);
    },
  );
});

// BI-CD13D818. A single ambiguous English word escalated a whole turn to
// `restricted`, which hard-denies every external provider and left the bundled
// local model as the only tool-capable route. Live evidence: a
// /platform/ai/operations-map conversation classified `employee-records`,
// "14 endpoint(s) excluded; 1 candidate(s) ranked", ~20% of recent decisions.
// Kernel decision DI-0A58373E26D0 chose corroboration over deleting the
// patterns, so detection stays intact and only the escalation bar moves.
describe("ambiguous-vocabulary corroboration (BI-CD13D818)", () => {
  const screen = (content: string) =>
    classifyInferencePayload({
      messages: [{ role: "user", content }],
      systemPrompt: "",
      taskType: "conversation",
    });

  it("does NOT escalate an AI-operations question to restricted on one ambiguous word", () => {
    const result = screen(
      "Which provider gives the best performance for this routing work, and what are the benefits of staying local?",
    );
    expect(result.overallSensitivity).not.toBe("restricted");
  });

  it("still fails closed at confidential — never silently drops to internal", () => {
    expect(screen("What are the benefits of the local model?").overallSensitivity)
      .toBe("confidential");
  });

  it("keeps precise employment vocabulary escalating on its own", () => {
    for (const text of [
      "The employee salary band needs review.",
      "Attach the disciplinary letter.",
      "Schedule the performance review.",
    ]) {
      expect(screen(text).overallSensitivity).toBe("restricted");
    }
  });

  it("escalates when precise vocabulary accompanies an ambiguous term", () => {
    // Fixture changed 2026-09-01 (BI-67CAF494). This asserted the same rule with
    // "payroll run" as its precise term; `payroll` has since moved to the
    // ambiguous set, because it names a domain rather than a record. The rule
    // under test is unchanged — `salary` is precise and still escalates beside an
    // ambiguous term.
    expect(screen("Review the salary bands and the benefits elections.").overallSensitivity)
      .toBe("restricted");
  });

  it("holds two ambiguous EMPLOYMENT words at confidential, not restricted", () => {
    // The deliberate behaviour change, pinned so it cannot regress silently:
    // naming two employment domains is a request ABOUT payroll, not payroll data.
    // Confidential still summons the PDP and still keeps the turn off any
    // endpoint lacking confidential clearance.
    expect(screen("Review the payroll run and the benefits elections.").overallSensitivity)
      .toBe("confidential");
  });

  it("does not let one ambiguous word repeated across probes fake corroboration", () => {
    const result = classifyInferencePayload({
      messages: [
        { role: "user", content: "What are the benefits here?" },
        { role: "assistant", content: "The benefits are latency and cost." },
        { role: "user", content: "Any other benefits?" },
      ],
      systemPrompt: "Explain the benefits of each route.",
      taskType: "conversation",
    });
    expect(result.overallSensitivity).toBe("confidential");
  });

  it("treats operations vocabulary as ambiguous for security-logs too", () => {
    expect(screen("Write an incident note about the stalled build.").overallSensitivity)
      .not.toBe("restricted");
    expect(
      classifyInferencePayload({
        messages: [{
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c1", name: "lookup", arguments: { securityLog: "redacted" } }],
        }],
        systemPrompt: "",
        taskType: "conversation",
      }).overallSensitivity,
    ).toBe("restricted");
  });

  it("never applies the corroboration bar to DECLARED governed data", () => {
    const result = classifyInferencePayload({
      messages: [{ role: "user", content: "Summarize this." }],
      systemPrompt: "",
      taskType: "conversation",
      governedData: [{
        assetId: "asset-1",
        classificationKnown: true,
        sensitivity: "restricted",
        dataClasses: ["employee-records"],
      }],
    });
    expect(result.overallSensitivity).toBe("restricted");
  });

  it("keeps the unknown-governed-data fail-closed intact", () => {
    const result = classifyInferencePayload({
      messages: [{ role: "user", content: "Summarize this." }],
      systemPrompt: "",
      taskType: "conversation",
      governedData: [{ assetId: "asset-2", classificationKnown: false }],
    });
    expect(result.overallSensitivity).toBe("restricted");
    expect(result.dataClasses).toContain("unknown-governed-data");
  });
});

// BI-463BE12A / BI-9C14CB5D. Measured on the live install over seven days: coo
// 36/36, market-research-analyst 50/50, admin-assistant 38/38, hr-specialist
// 33/33 and finance-agent 7/7 turns routed `restricted`, solely because their
// system prompts describe employment and finance work. `restricted` denies every
// external provider, so those five had one endpoint and no fallback.
describe("a coworker's job description is instruction, not payload", () => {
  // Close to the real assembled COO persona: it names payroll and invoices
  // because that is the job, and carries no actual employee or payment values.
  const persona =
    "You are the COO. You coordinate operations across the business: payroll " +
    "runs, invoice approvals, salary review cycles, and team performance.";
  const ask = { role: "user" as const, content: "What needs my attention this morning?" };

  it("does not escalate on a declared instruction span", () => {
    const result = classifyInferencePayload({
      messages: [ask],
      systemPrompt: persona,
      systemPromptInstructionSpans: [persona],
      taskType: "conversation",
    });

    expect(result.overallSensitivity).toBe("internal");
    expect(result.dataEvidencedClasses).toEqual([]);
  });

  it("still reports every detected class on the receipt", () => {
    // Suppressed for routing, never hidden from audit.
    const result = classifyInferencePayload({
      messages: [ask],
      systemPrompt: persona,
      systemPromptInstructionSpans: [persona],
      taskType: "conversation",
    });

    expect(result.dataClasses).toContain("employee-records");
    expect(result.matches.some((m) => m.path.startsWith("systemPrompt.instruction["))).toBe(true);
  });

  // The load-bearing safety property. An assembly path that declares nothing —
  // the legacy persona path, and every append made after assembly — classifies
  // the whole prompt as data and behaves exactly as it did before this existed.
  it("classifies the whole prompt as data when nothing is declared", () => {
    const result = classifyInferencePayload({
      messages: [ask],
      systemPrompt: persona,
      taskType: "conversation",
    });

    expect(result.overallSensitivity).toBe("restricted");
  });

  it("escalates on a real value in an UNDECLARED part of the prompt", () => {
    // An injected briefing or PAGE DATA block sits in the same string as the
    // persona. Declaring the persona must not launder what surrounds it.
    const result = classifyInferencePayload({
      messages: [ask],
      systemPrompt: `${persona}\n\n--- PAGE DATA ---\nDana Whitfield, salary 125000.`,
      systemPromptInstructionSpans: [persona],
      taskType: "conversation",
    });

    expect(result.overallSensitivity).toBe("restricted");
  });

  it("escalates on a real value in a message", () => {
    const result = classifyInferencePayload({
      messages: [{ role: "user", content: "Set Dana's salary to 125000 effective Monday." }],
      systemPrompt: persona,
      systemPromptInstructionSpans: [persona],
      taskType: "conversation",
    });

    expect(result.overallSensitivity).toBe("restricted");
  });

  it("escalates on a real value in a tool-call argument", () => {
    const result = classifyInferencePayload({
      messages: [{
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "update_person", arguments: { salary: 125000 } }],
      }],
      systemPrompt: persona,
      systemPromptInstructionSpans: [persona],
      taskType: "conversation",
    });

    expect(result.overallSensitivity).toBe("restricted");
  });

  it("leaves an explicit governed hint at full force", () => {
    const result = classifyInferencePayload({
      messages: [ask],
      systemPrompt: persona,
      systemPromptInstructionSpans: [persona],
      taskType: "conversation",
      governedData: [{ assetId: "asset-1", classificationKnown: true, sensitivity: "restricted" }],
    });

    expect(result.overallSensitivity).toBe("restricted");
  });

  it("ignores a declared span that assembly dropped under a token budget", () => {
    const result = classifyInferencePayload({
      messages: [ask],
      systemPrompt: "Be concise.",
      systemPromptInstructionSpans: [persona],
      taskType: "conversation",
    });

    expect(result.overallSensitivity).toBe("internal");
  });

  it("removes every occurrence of a span, not just the first", () => {
    const result = classifyInferencePayload({
      messages: [ask],
      systemPrompt: `${persona}\n\nReminder:\n${persona}`,
      systemPromptInstructionSpans: [persona],
      taskType: "conversation",
    });

    expect(result.overallSensitivity).toBe("internal");
  });

  it("matches the longest span first so a nested span cannot carve a hole", () => {
    const outer = `${persona} Escalate anything you cannot resolve.`;
    const result = classifyInferencePayload({
      messages: [ask],
      systemPrompt: outer,
      systemPromptInstructionSpans: [persona, outer],
      taskType: "conversation",
    });

    expect(result.overallSensitivity).toBe("internal");
  });
});

// BI-3F608240. Measured on the live install: of the COO's 15 turns that would
// still route `restricted` after the prompt-provenance fix, TWELVE were this
// single pattern — a tool-call argument NAMED `discipline`, matched as though it
// were an employment record.
describe("a field named 'discipline' is not evidence of an HR record", () => {
  const disciplineToolCall = {
    role: "assistant" as const,
    content: "",
    toolCalls: [{ id: "c1", name: "plan_work", arguments: { discipline: "platform-engineering" } }],
  };

  it("does not escalate on a tool argument named discipline alone", () => {
    // The exact live shape: messages[1].toolCalls[0].arguments.discipline
    const result = classifyInferencePayload({
      messages: [{ role: "user", content: "What should we tackle next?" }, disciplineToolCall],
      systemPrompt: "Be concise.",
      taskType: "conversation",
    });

    expect(result.overallSensitivity).not.toBe("restricted");
  });

  it("still fails closed at confidential rather than dropping to internal", () => {
    const result = classifyInferencePayload({
      messages: [disciplineToolCall],
      systemPrompt: "Be concise.",
      taskType: "conversation",
    });

    expect(result.overallSensitivity).toBe("confidential");
  });

  it("keeps the unambiguous employment spellings escalating on their own", () => {
    for (const key of ["disciplinary", "employeeDiscipline", "employee_discipline", "salary", "payroll"]) {
      const result = classifyInferencePayload({
        messages: [{
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c1", name: "update_person", arguments: { [key]: "x" } }],
        }],
        systemPrompt: "Be concise.",
        taskType: "conversation",
      });

      expect(result.overallSensitivity, `${key} must still escalate alone`).toBe("restricted");
    }
  });

  it("still escalates when discipline is corroborated by a second distinct reason", () => {
    // Corroboration is the point of the ambiguous tier: one ordinary word is not
    // proof, two distinct detectors are. Note it counts distinct REASONS, so a
    // second word from the same rule (compensation, manager) does not corroborate
    // — that is deliberate, per BI-CD13D818: many hits of one probe is one signal.
    const result = classifyInferencePayload({
      messages: [{
        role: "assistant",
        content: "",
        toolCalls: [{
          id: "c1",
          name: "plan_work",
          arguments: { discipline: "platform-engineering", incident: "INC-4" },
        }],
      }],
      systemPrompt: "Be concise.",
      taskType: "conversation",
    });

    expect(result.overallSensitivity).toBe("restricted");
  });

  it("does not let a second word from the SAME rule masquerade as corroboration", () => {
    const result = classifyInferencePayload({
      messages: [{
        role: "assistant",
        content: "",
        toolCalls: [{
          id: "c1",
          name: "plan_work",
          arguments: { discipline: "platform-engineering", compensation: "review" },
        }],
      }],
      systemPrompt: "Be concise.",
      taskType: "conversation",
    });

    expect(result.overallSensitivity).toBe("confidential");
  });
  it("does not treat an uncorroborated ambiguous match as data-evidenced (BI-DECCF716)", () => {
    // The live /workspace/inbox shape: a real contact detail, plus one ambiguous
    // employee-records reason echoed across a tool-call argument key and the
    // prompt remainder. `classifiedDataClasses` must still disclose everything;
    // `dataEvidencedClasses` is what selects the vertical packs, and one
    // ambiguous word must not put a `restricted`-bound class in front of the PDP.
    const result = classifyInferencePayload({
      messages: [
        { role: "user", content: "Group the decisions from pat@example.com's note." },
        {
          role: "assistant",
          content: "",
          toolCalls: [{
            id: "c1",
            name: "get_capability_completeness",
            arguments: { discipline: "platform-engineering" },
          }],
        },
      ],
      systemPrompt: "You keep an eye on delivery performance.",
      taskType: "conversation",
    });

    expect(result.overallSensitivity).toBe("confidential");
    expect(result.dataClasses).toContain("employee-records");
    expect(result.dataEvidencedClasses).toEqual(["customer-records"]);
  });

  it("keeps a restricted class data-evidenced once corroboration is met", () => {
    const result = classifyInferencePayload({
      messages: [{
        role: "assistant",
        content: "",
        toolCalls: [{
          id: "c1",
          name: "plan_work",
          arguments: { discipline: "platform-engineering", incident: "INC-4" },
        }],
      }],
      systemPrompt: "Be concise.",
      taskType: "conversation",
    });

    expect(result.overallSensitivity).toBe("restricted");
    expect(result.dataEvidencedClasses).toContain("employee-records");
  });

  it("keeps a caller-declared restricted hint data-evidenced on its own", () => {
    const result = classifyInferencePayload({
      messages: [{ role: "user", content: "Summarize this." }],
      systemPrompt: "Be concise.",
      taskType: "conversation",
      governedData: [{
        classificationKnown: true,
        sensitivity: "restricted",
        dataClasses: ["employee-records"],
      }],
    });

    expect(result.overallSensitivity).toBe("restricted");
    expect(result.dataEvidencedClasses).toContain("employee-records");
  });
});

describe("naming a domain is not evidence of a record in it (BI-67CAF494)", () => {
  function ask(content: string) {
    return classifyInferencePayload({
      messages: [{ role: "user" as const, content }],
      systemPrompt: "",
      taskType: "conversation",
    });
  }

  it("lets a coworker be ASKED for help with payroll", () => {
    // The live failure: a design-review request that said "payroll" and "tax
    // filing" classified restricted and clamped to local-only, so the reviewer
    // could not be reached. RouteDecisionLog 2026-09-01T20:03:07Z, AGT-WS-REVIEW,
    // classes ["employee-records","payments-finance"]. The message carried no
    // employee record and no payment value — only the name of the domain.
    const result = ask(
      "Please review the payroll tax acquisition design and record spec-approval.",
    );
    expect(result.overallSensitivity).not.toBe("restricted");
  });

  it("still escalates alone on a real employment value", () => {
    // Fails closed: the words that name the thing itself are unchanged.
    expect(ask("Her salary is being reviewed.").overallSensitivity).toBe("restricted");
    expect(ask("Attach the disciplinary letter.").overallSensitivity).toBe("restricted");
  });

  it("still escalates alone on a real payment identifier", () => {
    expect(ask("The routing number is on file.").overallSensitivity).toBe("restricted");
    expect(ask("His SSN is required for the filing.").overallSensitivity).toBe("restricted");
  });

  it("escalates when two DISTINCT domain words corroborate each other", () => {
    // One domain word is a subject; two independent ones start to look like a
    // payload. The corroboration bar is unchanged.
    const result = ask("Reconcile the payroll against the invoice.");
    expect(result.overallSensitivity).toBe("restricted");
  });

  it("does not let one word corroborate itself across two rules", () => {
    // The defect this closes: `payroll` sat in BOTH the employee-records and
    // payments-finance text patterns, so a single word produced two distinct
    // restricted reasons — exactly the corroboration bar. The guard corroborated
    // itself, and no amount of ambiguity marking would have helped.
    const reasons = new Set(
      ask("payroll").matches.filter((m) => m.dataClass !== "unknown-governed-data").map((m) => m.reason),
    );
    expect(reasons.size).toBeLessThan(2);
  });

  it("still reports every detected class on the receipt", () => {
    // Suppressed for routing, never hidden from audit.
    const result = ask("Please review the payroll tax acquisition design.");
    expect(result.dataClasses).toContain("employee-records");
  });
});
