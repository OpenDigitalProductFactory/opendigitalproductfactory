import { describe, expect, it } from "vitest";
import {
  createRoutedInferenceScreen,
  rescreenRoutedInferencePayload,
  rescreenRoutedInferenceWithoutTools,
} from "./routed-screening";
import { screenInferencePayload } from "./screen-inference-payload";

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
