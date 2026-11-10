import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { pageSource } from "../source-page";
import type { ReassessmentExecutionContext } from "../routing/reassessment-execution-scope";
import type { TerminalToolRecord } from "./terminal-tool-policy";
const mocks = vi.hoisted(() => ({ current: vi.fn(), tool: vi.fn(), actor: vi.fn(), user: vi.fn() }));
vi.mock("../routing/reassessment-execution-scope", async original => ({ ...await original<typeof import("../routing/reassessment-execution-scope")>(),
  currentFiniteReassessmentExecution: mocks.current, assertReassessmentToolCall: mocks.actor }));
vi.mock("../mcp-governed-execute", () => ({ governedExecuteTool: mocks.tool }));
vi.mock("../govern/current-user-context", () => ({ currentUserContext: mocks.user }));
import { fullReassessmentToolResult, preloadFiniteReassessment } from "./reassessment-preload";

const content = "FIRST\n" + "中".repeat(18_000) + "\nMIDDLE\n" + "z".repeat(18_000) + "\nLAST\n";
const ref = { kind: "repo-blob-at-commit" as const, repositoryFullName: "fixture/repository", path: "design.md", commitSha: "a".repeat(40),
  providerBlobId: createHash("sha1").update(`blob ${Buffer.byteLength(content)}\0${content}`).digest("hex") };
const fence = { schemaVersion: 1 as const, reservation: "reservation", dispatchClaim: "dispatch", authorityDigest: null, requestDigest: "b".repeat(64) };
const scope = { taskRunId: "TR-FIXTURE", userId: "human", agentId: "reviewer", executionFence: fence,
  binding: { itemId: "BI-FIXTURE", gate: "design-spec", writerToolName: "record_initiative_design_review", artifactRef: ref } } as ReassessmentExecutionContext;
const input = { userId: "human", agentId: "reviewer", taskRunId: scope.taskRunId, taskExecutionFence: fence, routeContext: "/review",
  threadId: "thread", apiTokenId: "token", tokenScope: "write" as const, tokenGrantScopes: ["file_read"], interactionMode: "autonomous" as const,
  chatHistory: [], externalAccessEnabled: false, tools: [{ name: "read_source_at_version", requiresExternalAccess: false }] };
const page = (args: Record<string, unknown>) => ({ success: true, message: "Actual governed page", data: {
  ...pageSource({ content, ref: ref.commitSha, path: ref.path, blobId: ref.providerBlobId, ...args }), repositoryFullName: ref.repositoryFullName,
} });
beforeEach(() => {
  vi.clearAllMocks(); mocks.current.mockReturnValue(scope); mocks.user.mockResolvedValue({ userId: "human", platformRole: "developer", isSuperuser: false });
  mocks.actor.mockImplementation(value => value.params); mocks.tool.mockImplementation(async ({ rawParams }) => page(rawParams));
});
describe("complete governed finite source preload", () => {
  it("traverses character-split pages through the real dispatch port and retains the full source/provenance", async () => {
    const records: TerminalToolRecord[] = [];
    const message = await preloadFiniteReassessment(input, records, mocks.tool);
    expect(records).toHaveLength(3); expect(records.map(record => record.result.data?.content).join("")).toBe(content);
    expect(records.every(record => record.modelEvidenceTruncated === false)).toBe(true);
    expect(message?.content).toContain("[untrusted");
    const data = JSON.parse(String(message?.content).split("\n").slice(1).join("\n")).data;
    expect(data).toMatchObject({ source: content, taskRunId: scope.taskRunId, artifactRef: ref });
    expect(data.reads).toHaveLength(3);
    const calls = mocks.tool.mock.calls.map(([call]) => call);
    expect(calls[0]).toMatchObject({ toolName: "read_source_at_version", userId: input.userId, source: "agentic-loop",
      rawParams: { startLine: 1, maxChars: 16_000, maxLines: 400, expectedBlobId: ref.providerBlobId },
      context: { taskRunId: scope.taskRunId, agentId: input.agentId, taskExecutionFence: fence, apiTokenId: input.apiTokenId,
        tokenScope: "write", tokenGrantScopes: ["file_read"] } });
    expect(calls[1].rawParams.cursor).toBe(records[0].result.data?.nextCursor);
    expect(calls[2].rawParams.cursor).toBe(records[1].result.data?.nextCursor);
    expect(calls[0].context.externalAccessEnabled).toBeUndefined();
  });
  it("does no reading for ordinary and legacy execution", async () => {
    mocks.current.mockReturnValue(null);
    expect(await preloadFiniteReassessment(input, [], mocks.tool)).toBeNull(); expect(mocks.tool).not.toHaveBeenCalled(); expect(mocks.user).not.toHaveBeenCalled();
  });
  it("preserves a qualification-phase refusal before any tool", async () => {
    mocks.current.mockImplementation(() => { throw Error("qualification-only"); });
    await expect(preloadFiniteReassessment(input, [], mocks.tool)).rejects.toThrow("qualification-only"); expect(mocks.tool).not.toHaveBeenCalled();
  });
  it.each(["refusal", "foreign-blob", "missing-content", "missing-size", "changed-size", "line-gap", "cycle", "false-final"])(
    "refuses %s instead of accepting partial evidence", async failure => {
      mocks.tool.mockImplementation(async ({ rawParams }) => {
        const result = page(rawParams), data = result.data as Record<string, unknown>;
        if (failure === "refusal") return { success: false, message: "Refused", error: "unavailable" };
        if (failure === "foreign-blob") data.blobId = "c".repeat(40);
        if (failure === "missing-content") delete data.content;
        if (failure === "missing-size") delete data.totalChars;
        if (rawParams.cursor && failure === "changed-size") data.totalChars = content.length + 1;
        if (rawParams.cursor && failure === "line-gap") data.startLine = 999;
        if (rawParams.cursor && failure === "cycle") { data.hasMore = true; data.nextCursor = rawParams.cursor; }
        if (failure === "false-final") { data.hasMore = false; data.nextCursor = null; data.endLine = data.totalLines; }
        return result;
      });
      await expect(preloadFiniteReassessment(input, [], mocks.tool)).rejects.toMatchObject({ code: "reassessment-preload-incomplete" });
    });
  it("does not substitute a result when complete capture throws", async () => {
    const error = Error("capture incomplete"); mocks.tool.mockRejectedValue(error);
    await expect(preloadFiniteReassessment(input, [], mocks.tool)).rejects.toBe(error);
  });
  it("refuses a view that sanitation would alter and retains complete refusal data otherwise", () => {
    expect(fullReassessmentToolResult({ success: false, message: "Correction", data: { detail: "x".repeat(20_000) } }, "writer")).toContain("x".repeat(20_000));
    expect(() => fullReassessmentToolResult({ success: true, message: "source\u200bhidden" }, "read_source_at_version")).toThrow(/complete bound immutable source/);
  });
});
