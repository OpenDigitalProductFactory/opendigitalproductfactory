/**
 * EP-INF-005a: RequestContract type and contract inference tests (TDD red phase).
 * See: docs/superpowers/specs/2026-03-18-ai-routing-and-profiling-design.md
 */

import { describe, expect, it } from "vitest";
import { inferContract } from "./request-contract";
import type { RequestContract } from "./request-contract";

// ── Helpers ──────────────────────────────────────────────────────────────────

function textMsg(role: string, text: string) {
  return { role, content: text };
}

function multimodalMsg(
  role: string,
  parts: Array<{ type: string; [k: string]: unknown }>,
) {
  return { role, content: parts };
}

const SIMPLE_MESSAGES = [
  textMsg("user", "Hello, how are you?"),
  textMsg("assistant", "I'm fine, thanks!"),
];

const SAMPLE_TOOLS = [
  { type: "function", function: { name: "search", parameters: {} } },
];

const SAMPLE_SCHEMA = {
  type: "object",
  properties: { answer: { type: "string" } },
};

// ── Tool detection ──────────────────────────────────────────────────────────

describe("inferContract – tool detection", () => {
  it("sets requiresTools=true when tools are provided", async () => {
    const contract = await inferContract("tool-action", SIMPLE_MESSAGES, SAMPLE_TOOLS);
    expect(contract.requiresTools).toBe(true);
  });

  it("sets requiresTools=false when tools are undefined", async () => {
    const contract = await inferContract("greeting", SIMPLE_MESSAGES);
    expect(contract.requiresTools).toBe(false);
  });

  it("sets requiresTools=false when tools array is empty", async () => {
    const contract = await inferContract("greeting", SIMPLE_MESSAGES, []);
    expect(contract.requiresTools).toBe(false);
  });
});

// ── Schema detection ────────────────────────────────────────────────────────

describe("inferContract – schema detection", () => {
  it("sets requiresStrictSchema=true when outputSchema is provided", async () => {
    const contract = await inferContract(
      "data-extraction",
      SIMPLE_MESSAGES,
      undefined,
      SAMPLE_SCHEMA,
    );
    expect(contract.requiresStrictSchema).toBe(true);
  });

  it("sets requiresStrictSchema=false when outputSchema is undefined", async () => {
    const contract = await inferContract("greeting", SIMPLE_MESSAGES);
    expect(contract.requiresStrictSchema).toBe(false);
  });

  it("includes 'json' in modality.output when outputSchema provided", async () => {
    const contract = await inferContract(
      "data-extraction",
      SIMPLE_MESSAGES,
      undefined,
      SAMPLE_SCHEMA,
    );
    expect(contract.modality.output).toContain("json");
  });
});

// ── Modality detection ──────────────────────────────────────────────────────

describe("inferContract – modality detection", () => {
  it("detects image modality from multimodal message content", async () => {
    const msgs = [
      multimodalMsg("user", [
        { type: "text", text: "What is in this image?" },
        { type: "image", source: { type: "base64", data: "..." } },
      ]),
    ];
    const contract = await inferContract("creative", msgs);
    expect(contract.modality.input).toContain("text");
    expect(contract.modality.input).toContain("image");
  });

  it("detects file modality from multimodal message content", async () => {
    const msgs = [
      multimodalMsg("user", [
        { type: "text", text: "Analyze this document" },
        { type: "file", source: { type: "url", url: "..." } },
      ]),
    ];
    const contract = await inferContract("data-extraction", msgs);
    expect(contract.modality.input).toContain("file");
  });

  it("detects audio modality from multimodal message content", async () => {
    const msgs = [
      multimodalMsg("user", [
        { type: "text", text: "Transcribe this" },
        { type: "audio", source: { type: "base64", data: "..." } },
      ]),
    ];
    const contract = await inferContract("creative", msgs);
    expect(contract.modality.input).toContain("audio");
  });

  it("includes tool_call in output modality when tools provided", async () => {
    const contract = await inferContract("tool-action", SIMPLE_MESSAGES, SAMPLE_TOOLS);
    expect(contract.modality.output).toContain("text");
    expect(contract.modality.output).toContain("tool_call");
  });

  it("defaults to text-only input and text-only output", async () => {
    const contract = await inferContract("greeting", SIMPLE_MESSAGES);
    expect(contract.modality.input).toEqual(["text"]);
    expect(contract.modality.output).toEqual(["text"]);
  });
});

// ── Reasoning depth mapping ─────────────────────────────────────────────────

describe("inferContract – reasoning depth", () => {
  const cases: Array<[string, RequestContract["reasoningDepth"]]> = [
    ["greeting", "minimal"],
    ["status-query", "low"],
    ["summarization", "low"],
    ["web-search", "low"],
    ["creative", "medium"],
    ["data-extraction", "medium"],
    ["code-gen", "medium"],
    ["tool-action", "medium"],
    ["reasoning", "high"],
  ];

  for (const [taskType, expected] of cases) {
    it(`maps taskType="${taskType}" to reasoningDepth="${expected}"`, async () => {
      const contract = await inferContract(taskType, SIMPLE_MESSAGES);
      expect(contract.reasoningDepth).toBe(expected);
    });
  }

  it("defaults unknown task types to medium", async () => {
    const contract = await inferContract("totally-unknown-task", SIMPLE_MESSAGES);
    expect(contract.reasoningDepth).toBe("medium");
  });
});

// ── Contract family derivation ──────────────────────────────────────────────

describe("inferContract – contract family", () => {
  it("derives contractFamily as sync.<taskType> by default", async () => {
    const contract = await inferContract("code-gen", SIMPLE_MESSAGES);
    expect(contract.contractFamily).toBe("sync.code-gen");
  });

  it("uses interactionMode from routeContext in contractFamily", async () => {
    const contract = await inferContract(
      "data-extraction",
      SIMPLE_MESSAGES,
      undefined,
      undefined,
      { interactionMode: "background" },
    );
    expect(contract.contractFamily).toBe("background.data-extraction");
  });

  it("preserves taskType on the contract", async () => {
    const contract = await inferContract("code-gen", SIMPLE_MESSAGES);
    expect(contract.taskType).toBe("code-gen");
  });
});

// ── Token estimation ────────────────────────────────────────────────────────

describe("inferContract – token estimation", () => {
  it("estimates input tokens from message string length / 4", async () => {
    const msgs = [textMsg("user", "a".repeat(400))]; // 400 chars → 100 tokens
    const contract = await inferContract("greeting", msgs);
    expect(contract.estimatedInputTokens).toBe(100);
  });

  it("estimates 1000 tokens for multimodal content arrays", async () => {
    const msgs = [
      multimodalMsg("user", [
        { type: "text", text: "describe" },
        { type: "image", source: { type: "base64", data: "..." } },
      ]),
    ];
    const contract = await inferContract("creative", msgs);
    expect(contract.estimatedInputTokens).toBe(1000);
  });

  it("defaults estimatedOutputTokens to 500", async () => {
    const contract = await inferContract("greeting", SIMPLE_MESSAGES);
    expect(contract.estimatedOutputTokens).toBe(500);
  });

  it("sets minContextTokens to estimatedInputTokens * 1.5", async () => {
    const msgs = [textMsg("user", "a".repeat(400))]; // 100 input tokens
    const contract = await inferContract("greeting", msgs);
    expect(contract.minContextTokens).toBe(150);
  });
});

// ── Route context overrides ─────────────────────────────────────────────────

describe("inferContract – route context overrides", () => {
  it("applies sensitivity from routeContext", async () => {
    const contract = await inferContract(
      "greeting",
      SIMPLE_MESSAGES,
      undefined,
      undefined,
      { sensitivity: "confidential" },
    );
    expect(contract.sensitivity).toBe("confidential");
  });

  it("applies budgetClass from routeContext", async () => {
    const contract = await inferContract(
      "greeting",
      SIMPLE_MESSAGES,
      undefined,
      undefined,
      { budgetClass: "quality_first" },
    );
    expect(contract.budgetClass).toBe("quality_first");
  });

  it("applies maxLatencyMs from routeContext", async () => {
    const contract = await inferContract(
      "greeting",
      SIMPLE_MESSAGES,
      undefined,
      undefined,
      { maxLatencyMs: 2000 },
    );
    expect(contract.maxLatencyMs).toBe(2000);
  });

  it("applies allowedProviders from routeContext", async () => {
    const contract = await inferContract(
      "greeting",
      SIMPLE_MESSAGES,
      undefined,
      undefined,
      { allowedProviders: ["anthropic", "openai"] },
    );
    expect(contract.allowedProviders).toEqual(["anthropic", "openai"]);
  });

  it("applies residencyPolicy from routeContext", async () => {
    const contract = await inferContract(
      "greeting",
      SIMPLE_MESSAGES,
      undefined,
      undefined,
      { residencyPolicy: "local_only" },
    );
    expect(contract.residencyPolicy).toBe("local_only");
  });
});

// ── Defaults ────────────────────────────────────────────────────────────────

describe("inferContract – defaults", () => {
  it("defaults sensitivity to internal", async () => {
    const contract = await inferContract("greeting", SIMPLE_MESSAGES);
    expect(contract.sensitivity).toBe("internal");
  });

  it("defaults budgetClass to balanced", async () => {
    const contract = await inferContract("greeting", SIMPLE_MESSAGES);
    expect(contract.budgetClass).toBe("balanced");
  });

  it("defaults interactionMode to sync", async () => {
    const contract = await inferContract("greeting", SIMPLE_MESSAGES);
    expect(contract.interactionMode).toBe("sync");
  });

  it("defaults requiresStreaming to true for sync mode", async () => {
    const contract = await inferContract("greeting", SIMPLE_MESSAGES);
    expect(contract.requiresStreaming).toBe(true);
  });

  it("defaults requiresStreaming to false for background mode", async () => {
    const contract = await inferContract(
      "greeting",
      SIMPLE_MESSAGES,
      undefined,
      undefined,
      { interactionMode: "background" },
    );
    expect(contract.requiresStreaming).toBe(false);
  });
});

// ── Capability flags (EP-INF-008b) ──────────────────────────────────────────

describe("inferContract – capability flags", () => {
  it("sets requiresWebSearch for web-search task type", async () => {
    const contract = await inferContract("web-search", SIMPLE_MESSAGES);
    expect(contract.requiresWebSearch).toBe(true);
  });

  it("does not set requiresWebSearch for non-web-search tasks", async () => {
    const contract = await inferContract("greeting", SIMPLE_MESSAGES);
    expect(contract.requiresWebSearch).toBeUndefined();
  });

  it("sets requiresCodeExecution from route context", async () => {
    const contract = await inferContract("code-gen", SIMPLE_MESSAGES, undefined, undefined, {
      requiresCodeExecution: true,
    });
    expect(contract.requiresCodeExecution).toBe(true);
  });

  it("sets requiresComputerUse from route context", async () => {
    const contract = await inferContract("tool-action", SIMPLE_MESSAGES, undefined, undefined, {
      requiresComputerUse: true,
    });
    expect(contract.requiresComputerUse).toBe(true);
  });

  it("does not set capability flags by default", async () => {
    const contract = await inferContract("greeting", SIMPLE_MESSAGES);
    expect(contract.requiresCodeExecution).toBeUndefined();
    expect(contract.requiresComputerUse).toBeUndefined();
  });
});

// ── Unique contractId ───────────────────────────────────────────────────────

describe("inferContract – contractId", () => {
  it("generates a unique contractId per call", async () => {
    const c1 = await inferContract("greeting", SIMPLE_MESSAGES);
    const c2 = await inferContract("greeting", SIMPLE_MESSAGES);
    expect(c1.contractId).toBeTruthy();
    expect(c2.contractId).toBeTruthy();
    expect(c1.contractId).not.toBe(c2.contractId);
  });

  it("contractId is a valid UUID format", async () => {
    const contract = await inferContract("greeting", SIMPLE_MESSAGES);
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(contract.contractId).toMatch(uuidRegex);
  });
});
