import { describe, expect, it } from "vitest";
import {
  createRoutedInferenceScreen,
  rescreenRoutedInferencePayload,
  rescreenRoutedInferenceWithoutTools,
} from "./routed-screening";
import { screenInferencePayload } from "./screen-inference-payload";
import { readRehydrationTokenMap } from "@/lib/govern/data/rehydration-token-vault";

describe("routed inference screening", () => {
  it("tokenizes replaceable contact data before routing and preserves source classification evidence", () => {
    const raw = "ada@example.com";
    const routed = createRoutedInferenceScreen({
      messages: [{ role: "user", content: `Draft a greeting for ${raw}.` }],
      systemPrompt: "Do not reveal private contact details.",
      taskType: "draft",
      routeContext: { sensitivity: "internal" },
      sensitiveDetailUse: "replaceable",
    });

    expect(JSON.stringify(routed.screenInput)).not.toContain(raw);
    expect(JSON.stringify(routed.screenInput)).toContain("[DPF_TOKEN_");
    expect(routed.screen.receipt.transformation).toBe("tokenized");
    expect(routed.screen.receipt.classifiedDataClasses).toContain("customer-records");
    expect(routed.screen.receipt.obligationKinds).toContain("mask");
    expect(routed.screen.receipt.routeEffect).toBe("allow");
    expect(routed.rehydrationHandle).toMatch(/^rehydration_/);
  });

  it("binds tokens to caller-owned actor/subject intent and screen-owned governance evidence", () => {
    const raw = "ada@example.com";
    const routed = createRoutedInferenceScreen({
      messages: [{ role: "user", content: `Draft a greeting for ${raw}.` }],
      systemPrompt: "",
      taskType: "draft",
      routeContext: { sensitivity: "public" },
      sensitiveDetailUse: "replaceable",
      policyVersionSource: () => ({
        assetVersion: "asset-v1",
        classificationVersion: "classification-v1",
        authorityVersion: "authority-v1",
        policyBundleVersion: "bundle-v1",
      }),
      responseRehydration: {
        expectedActor: {
          principalId: "PRN-1",
          actingHumanUserId: "user-1",
          actingAgentId: null,
          delegationGrantId: null,
        },
        purpose: "coworker-assistance",
        surface: "private-customer",
        subject: { kind: "account", id: "account-1" },
        pathPrefixes: ["messages"],
      },
    });

    const read = readRehydrationTokenMap(routed.rehydrationHandle ?? "");
    expect(read.status).toBe("available");
    if (read.status !== "available") return;
    const stored = [...read.tokens.values()][0];
    expect(stored?.bindings).toEqual([
      expect.objectContaining({
        purpose: "coworker-assistance",
        surface: "private-customer",
        subject: { kind: "account", id: "account-1" },
        pathPrefixes: ["messages"],
        sensitivity: "confidential",
        dataClasses: expect.arrayContaining(["customer-records"]),
        decisionVersions: expect.arrayContaining([
          expect.objectContaining({
            classificationVersion: "classification-v1",
          }),
        ]),
      }),
    ]);
  });

  it("keeps material contact data local instead of masking it into a misleading request", () => {
    const raw = "ada@example.com";
    const routed = createRoutedInferenceScreen({
      messages: [{ role: "user", content: `Validate the exact address ${raw}.` }],
      systemPrompt: "Validate exact values.",
      taskType: "validation",
      routeContext: { sensitivity: "internal" },
      sensitiveDetailUse: "material",
    });

    expect(JSON.stringify(routed.screenInput)).toContain(raw);
    expect(routed.screen.receipt.transformation).toBe("none");
    expect(routed.screen.receipt.routeEffect).toBe("local-only");
    expect(routed.rehydrationHandle).toBeUndefined();
  });

  it("recomputes source mask authority versions at the final dispatch screen", () => {
    let classificationVersion = "classification-v1";
    const routed = createRoutedInferenceScreen({
      messages: [{ role: "user", content: "Draft for ada@example.com" }],
      systemPrompt: "",
      taskType: "draft",
      routeContext: { sensitivity: "internal" },
      sensitiveDetailUse: "replaceable",
      policyVersionSource: () => ({
        assetVersion: "asset-v1",
        classificationVersion,
        authorityVersion: "authority-v1",
        policyBundleVersion: "bundle-v1",
      }),
    });
    const routedReceipt = routed.screen.receipt;

    classificationVersion = "classification-v2";
    const dispatchReceipt = screenInferencePayload(routed.screenInput).receipt;

    expect(dispatchReceipt.decisionIds).not.toEqual(routedReceipt.decisionIds);
    expect(dispatchReceipt.decisionVersions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ classificationVersion: "classification-v2" }),
      ]),
    );
  });

  it("keeps tool declarations in the receipt hash without classifying schema names as live data", () => {
    const routed = createRoutedInferenceScreen({
      messages: [{ role: "user", content: "Summarize the public release." }],
      systemPrompt: "Use only public material.",
      tools: [
        {
          name: "lookup",
          parameters: {
            type: "object",
            properties: { password: { type: "string" } },
          },
        },
      ],
      taskType: "summarization",
      routeContext: { sensitivity: "internal" },
    });

    const stripped = rescreenRoutedInferenceWithoutTools(routed.screenInput);

    expect(routed.screen.receipt.classifiedDataClasses).not.toContain("secrets-credentials");
    expect(routed.screen.receipt.routeEffect).toBe("allow");
    expect(stripped.receipt.classifiedDataClasses).not.toContain("secrets-credentials");
    expect(stripped.receipt.inputHash).not.toBe(routed.screen.receipt.inputHash);
    expect(stripped.screenInput.tools).toBeUndefined();
  });

  it("issues a new receipt when capability degradation replaces prompt and history", () => {
    const routed = createRoutedInferenceScreen({
      messages: [
        { role: "assistant", content: "Earlier tool call." },
        { role: "user", content: "Current request." },
      ],
      systemPrompt: "Use tools.",
      taskType: "conversation",
      routeContext: { sensitivity: "internal" },
    });
    const replaced = rescreenRoutedInferencePayload(routed.screenInput, {
      messages: [{ role: "user", content: "Current request." }],
      systemPrompt: "Limited mode.",
      tools: undefined,
    });

    expect(replaced.receipt.inputHash).not.toBe(routed.screen.receipt.inputHash);
    expect(replaced.screenInput.messages).toHaveLength(1);
    expect(replaced.screenInput.systemPrompt).toBe("Limited mode.");
  });
});

// BI-463BE12A / BI-9C14CB5D. The end-to-end assertion, at the seam routing
// actually consumes. Four channels clamp a turn to local-only — sensitivity
// clearance, the per-class export decision, the vertical policy packs, and a
// mask obligation that clamps residencyPolicy — so a unit test on the
// classifier alone proves nothing about whether a coworker can reach a provider.
describe("prompt provenance decides whether a turn may leave the box", () => {
  const persona =
    "You are the COO. You coordinate operations: payroll runs, invoice approvals, " +
    "salary review cycles, and team performance.";

  const screenWith = (systemPrompt: string, content: string, spans?: string[]) =>
    createRoutedInferenceScreen({
      messages: [{ role: "user", content }],
      systemPrompt,
      systemPromptInstructionSpans: spans,
      taskType: "conversation",
      routeContext: { sensitivity: "confidential", residencyPolicy: "any_enabled" },
    }).screen;

  it("lets a job description with no governed data reach a cloud provider", () => {
    const screen = screenWith(persona, "What needs my attention this morning?", [persona]);

    expect(screen.receipt.routeEffect).toBe("allow");
    expect(screen.routeContext.residencyPolicy).toBe("any_enabled");
  });

  it("keeps reporting the detected classes even when they change nothing", () => {
    const screen = screenWith(persona, "What needs my attention this morning?", [persona]);

    expect(screen.receipt.classifiedDataClasses).toContain("employee-records");
    expect(screen.receipt.matchProvenance?.every((m) => m.path.startsWith("systemPrompt.instruction["))).toBe(true);
  });

  it("clamps to local-only for a real value in a message", () => {
    const screen = screenWith(persona, "Set Dana's salary to 125000 Monday.", [persona]);

    expect(screen.receipt.routeEffect).toBe("local-only");
    expect(screen.routeContext.residencyPolicy).toBe("local_only");
  });

  it("clamps to local-only for a real value in an UNDECLARED prompt segment", () => {
    const screen = screenWith(
      `${persona}\n\n--- PAGE DATA ---\nDana Whitfield, salary 125000, payroll id 88213.`,
      "Summarise this.",
      [persona],
    );

    expect(screen.receipt.routeEffect).toBe("local-only");
    expect(screen.routeContext.residencyPolicy).toBe("local_only");
  });

  it("is unchanged for a caller that declares nothing", () => {
    const screen = screenWith(persona, "What needs my attention this morning?");

    expect(screen.routeContext.sensitivity).toBe("restricted");
    expect(screen.receipt.routeEffect).toBe("local-only");
  });
});

// BI-DECCF716. The provenance split above covers the coworker's job description.
// This is the panel shape it does not cover: message content and prior tool calls
// are data by construction, so one ambiguous word there used to load the
// employee-records pack, whose `restricted` binding sensitivity overrode the
// corroboration-gated verdict and denied export outright.
describe("an uncorroborated ambiguous word does not deny export", () => {
  const persona =
    "You are the COO. You coordinate operations: payroll runs, invoice approvals, " +
    "salary review cycles, and team performance.";

  const inboxTurn = () =>
    createRoutedInferenceScreen({
      messages: [
        {
          role: "user",
          content: "How many distinct decisions are in my inbox today? Note from pat@example.com.",
        },
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
      systemPrompt: persona,
      systemPromptInstructionSpans: [persona],
      taskType: "conversation",
      routeContext: { sensitivity: "confidential", residencyPolicy: "any_enabled" },
    }).screen;

  it("no longer reaches the restricted export denial", () => {
    const screen = inboxTurn();

    expect(screen.receipt.policyEffect).not.toBe("deny");
    expect(screen.receipt.explanationCodes).not.toContain("restricted-cannot-leave-boundary");
  });

  it("does not load the pack for the uncorroborated class", () => {
    const screen = inboxTurn();

    expect(screen.receipt.policyPackVersions).toEqual(["vertical-customer-records@1.0.0"]);
    expect(screen.receipt.classifiedDataClasses).toContain("employee-records");
  });

  it("still holds the turn local for the contact detail it really carries", () => {
    // Not a regression: the mask obligation from a real contact detail is the
    // second, separate clamp (BI-0064680C). Asserted so a later change to that
    // path shows up here rather than silently widening this one.
    const screen = inboxTurn();

    expect(screen.receipt.obligationKinds).toContain("mask");
    expect(screen.routeContext.residencyPolicy).toBe("local_only");
  });
});
