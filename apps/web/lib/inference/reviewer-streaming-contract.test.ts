import { describe, expect, it } from "vitest";
import { buildEffectiveRequestContract, buildInitialRouteContext } from "./route-contract-builder";
import { inferContract } from "../routing/request-contract";

const messages = [{ role: "user", content: "Review the immutable design." }];
const tools = [{ type: "function", function: { name: "record_initiative_evidence", parameters: {} } }];

describe("reviewer streaming contract (BI-87148687)", () => {
  it("propagates completed-result non-streaming intent without background delivery", async () => {
    const options = { requiresStreaming: false, toolChoice: "required" as const,
      terminalWriterToolName: "record_initiative_evidence" };
    const routeContext = buildInitialRouteContext({ sensitivity: "internal", options,
      posture: null, localOnlyInference: false });
    const contract = await buildEffectiveRequestContract({ taskType: "external-mcp",
      messages, tools, routeContext, options, taskRequirement: null });
    expect(contract).toMatchObject({ requiresStreaming: false, interactionMode: "sync",
      requiresTools: true, toolChoice: "required", terminalWriterToolName: options.terminalWriterToolName });
  });

  it.each([undefined, true, false])("honors explicit streaming %s and preserves omitted sync defaults", async (requiresStreaming) => {
    const contract = await inferContract("external-mcp", messages, tools, undefined,
      { requiresStreaming }, null);
    expect(contract.requiresStreaming).toBe(requiresStreaming ?? true);
    expect(contract.interactionMode).toBe("sync");
  });

  it("retains background defaults and local-only policy independently of streaming", async () => {
    const routeContext = buildInitialRouteContext({ sensitivity: "restricted",
      options: { requiresStreaming: false, interactionMode: "background" },
      posture: null, localOnlyInference: true });
    const contract = await inferContract("external-mcp", messages, tools, undefined, routeContext, null);
    expect(contract).toMatchObject({ requiresStreaming: false, interactionMode: "background",
      sensitivity: "restricted", residencyPolicy: "local_only", requiresTools: true });
  });
});
