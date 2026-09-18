import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/routed-inference", () => ({ previewRoute: vi.fn() }));
import { previewRoute, type RouteAndCallOptions } from "@/lib/routed-inference";
import { rotateTerminalWriterRoute } from "./terminal-writer-route";
import type { TerminalToolPolicy, TerminalToolRecord } from "./terminal-tool-policy";

const policy: TerminalToolPolicy = { writerToolName: "record_review", readerToolNames: ["read_source"], minimumSuccessfulReaderCalls: 1, maximumReaderCalls: 6, terminalPhase: "writer-only", persistedEvidenceAvailable: true };
const input = (options: RouteAndCallOptions, records: TerminalToolRecord[] = []) => ({ policy, records, options, providerId: "gemini", messages: [{ role: "user" as const, content: "Record the review." }], systemPrompt: "Review independently.", sensitivity: "confidential" as const });

describe("bounded terminal writer routing", () => {
  beforeEach(() => vi.resetAllMocks());
  it("retains the only usable provider and all policy exclusions when no alternative exists", async () => {
    vi.mocked(previewRoute).mockResolvedValue({ decision: { selectedEndpoint: null } } as never);
    const options: RouteAndCallOptions = { deniedProviders: ["policy-denied"], preferredProviderId: "gemini", toolChoice: "required" };
    await rotateTerminalWriterRoute(input(options));
    expect(options).toEqual({ deniedProviders: ["policy-denied"], preferredProviderId: "gemini", toolChoice: "required" });
    expect(vi.mocked(previewRoute).mock.calls[0]![2]).toMatchObject({ deniedProviders: ["policy-denied", "gemini"], toolChoice: "required", screeningSystemPrompt: "Review independently." });
  });
  it("rotates only after a usable alternative is previewed", async () => {
    vi.mocked(previewRoute).mockResolvedValue({ decision: { selectedEndpoint: "other-http-provider" } } as never);
    const options: RouteAndCallOptions = { deniedProviders: ["policy-denied"], preferredProviderId: "gemini" };
    await rotateTerminalWriterRoute(input(options));
    expect(options.deniedProviders).toEqual(["policy-denied", "gemini"]);
    expect(options.preferredProviderId).toBeUndefined();
  });
  it("does not rotate for a writer validation correction or approval response", async () => {
    for (const error of ["malformed-receipt", "approval_required"]) {
      const options: RouteAndCallOptions = {};
      await rotateTerminalWriterRoute(input(options, [{ name: "record_review", result: { success: false, error } }]));
      expect(options).toEqual({});
    }
    expect(previewRoute).not.toHaveBeenCalled();
  });
  it("a failed preview grants no new route and does not remove existing restrictions", async () => {
    vi.mocked(previewRoute).mockRejectedValue(new Error("policy unavailable"));
    const options: RouteAndCallOptions = { allowedProviders: ["gemini"], deniedProviders: ["policy-denied"] };
    await rotateTerminalWriterRoute(input(options));
    expect(options).toEqual({ allowedProviders: ["gemini"], deniedProviders: ["policy-denied"] });
  });
});
