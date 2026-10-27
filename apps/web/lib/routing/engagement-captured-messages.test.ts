import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { buildEngagementMessagesBody, parseEngagementMessagesReply, executeEngagementMessages,
  ENGAGEMENT_RESPONSE_ENCODING } from "./engagement-captured-messages";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHNcAAAAASUVORK5CYII=";
const imageSha = createHash("sha256").update(Buffer.from(png, "base64")).digest("hex");
const input = () => ({ modelDigest: "sha256:" + "a".repeat(64), systemPrompt: "Registered UX Critic persona",
  content: [{ type: "text" as const, text: "Actual governed source basis and corpus" },
    { type: "image_url" as const, image_url: { url: `data:image/png;base64,${png}` } }],
  imageSha256: [imageSha], maxOutputTokens: 2048, maxImageBytes: 4_000_000, maxImagePixels: 40_000_000 });
const contribution = () => ({ summary: "Advisory critique", criteria: ["Progressive disclosure"],
  corpusRefs: ["professions/ux-design/information-hierarchy-and-density"], findings: [{ severity: "medium", criterion: "Progressive disclosure",
    observation: "The decision reason is difficult to find.", evidence: "The request decision capture", proposedCorrection: "Show the reason next to the selected destination.", captureState: "request-decision" }],
  limitations: ["Four desktop dark captures; static source basis."], reviewedArtifacts: ["prototype@immutable"], calibrationLimitations: ["Empty calibrated corpus; advisory."] });
const reply = () => ({ id: "msg-real", type: "message", role: "assistant", model: input().modelDigest,
  content: [{ type: "tool_use", id: "answer", name: "return_ux_critique", input: contribution() }],
  stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 100, cache_read_input_tokens: 0, output_tokens: 200 } });

describe("captured Messages Critic output encoding", () => {
  it("freezes actual pixels and exactly one non-executable response schema", () => {
    const prepared = buildEngagementMessagesBody(input());
    const body = JSON.parse(prepared.bodyUtf8);
    expect(body.messages[0].content[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: png } });
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].name).toBe(ENGAGEMENT_RESPONSE_ENCODING.name);
    expect(body.tool_choice).toEqual({ type: "any" });
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(prepared.imageSha256).toEqual([imageSha]);
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(prepared.bodySha256).toBe(createHash("sha256").update(prepared.bodyUtf8).digest("hex"));
  });
  it.each(["https://example.test/pixels.png", "file:///pixels.png", "data:image/jpeg;base64," + png, "data:image/png;base64,broken"])("refuses substituted or unsupported image bytes before provider effects", url => {
    const value = input(); value.content[1] = { type: "image_url", image_url: { url } };
    expect(() => buildEngagementMessagesBody(value)).toThrow();
  });
  it("refuses hash or image ordering drift", () => {
    expect(() => buildEngagementMessagesBody({ ...input(), imageSha256: ["0".repeat(64)] })).toThrow();
    expect(() => buildEngagementMessagesBody({ ...input(), imageSha256: [] })).toThrow();
  });
  it("takes the actual response function INPUT as the candidate answer without executing it", () => {
    const parsed = parseEngagementMessagesReply(JSON.stringify(reply()), { inputTokens: 100, maxOutputTokens: 2048, expectedModel: input().modelDigest });
    expect(JSON.parse(parsed.content)).toEqual(contribution());
    expect(parsed.usage).toEqual({ inputTokens: 100, outputTokens: 200, cacheReadInputTokens: 0 });
  });
  it.each([
    (r: ReturnType<typeof reply>) => { r.content = []; },
    (r: ReturnType<typeof reply>) => { r.content.push(r.content[0]); },
    (r: ReturnType<typeof reply>) => { r.content[0].name = "execute_tool"; },
    (r: ReturnType<typeof reply>) => { r.stop_reason = "max_tokens"; },
    (r: ReturnType<typeof reply>) => { r.usage.input_tokens = 101; },
    (r: ReturnType<typeof reply>) => { r.usage.output_tokens = 2049; },
    (r: ReturnType<typeof reply>) => { (r.content[0].input as Record<string, unknown>).authority = "approved"; },
    (r: ReturnType<typeof reply>) => { r.content[0].input.criteria = []; },
    (r: ReturnType<typeof reply>) => { r.content.push({ type: "text", text: "conflicting prose" } as never); },
  ])("rejects incomplete, extra, unauthorized or unbounded output without dispatching a tool", mutate => {
    const value = reply(); mutate(value);
    expect(() => parseEngagementMessagesReply(JSON.stringify(value), { inputTokens: 100, maxOutputTokens: 2048, expectedModel: input().modelDigest })).toThrow();
  });
  it("rejects duplicate object fields in the captured raw reply", () => {
    const raw = JSON.stringify(reply()).replace('"summary":"Advisory critique"', '"summary":"Advisory critique","summary":"different"');
    expect(() => parseEngagementMessagesReply(raw, { inputTokens: 100, maxOutputTokens: 2048, expectedModel: input().modelDigest })).toThrow();
  });
  it("counts and generates the exact same body once; no follow-up or platform tool dispatch exists", async () => {
    const prepared = buildEngagementMessagesBody(input());
    const count = vi.fn(async () => '{"input_tokens":100}');
    const generate = vi.fn(async () => JSON.stringify(reply()));
    const result = await executeEngagementMessages(prepared, { perTaskTokens: 20_000, contextTokens: 20_000 }, { count, generate });
    expect(result.content).toBe(JSON.stringify(contribution()));
    expect(count).toHaveBeenCalledExactlyOnceWith(prepared.bodyUtf8);
    expect(generate).toHaveBeenCalledExactlyOnceWith(prepared.bodyUtf8, { bodySha256: prepared.bodySha256, inputTokens: 100, maxOutputTokens: 2048, reservedTokens: 2148 });
  });
  it("holds an oversized or failed count before generation, with no recount or alternate wire", async () => {
    const prepared = buildEngagementMessagesBody(input());
    for (const counted of ['{"input_tokens":19000}', '{"input_tokens":-1}', '{"error":"unavailable"}']) {
      const prepared = buildEngagementMessagesBody(input());
      const count = vi.fn(async () => counted), generate = vi.fn();
      await expect(executeEngagementMessages(prepared, { perTaskTokens: 20_000, contextTokens: 20_000 }, { count, generate })).rejects.toThrow();
      expect(count).toHaveBeenCalledTimes(1); expect(generate).not.toHaveBeenCalled();
    }
  });
  it("never retries a lost generation acknowledgement", async () => {
    const prepared = buildEngagementMessagesBody(input());
    const count = vi.fn(async () => '{"input_tokens":100}');
    const generate = vi.fn(async () => { throw new Error("provider-outcome-uncertain"); });
    await expect(executeEngagementMessages(prepared, { perTaskTokens: 20_000, contextTokens: 20_000 }, { count, generate })).rejects.toThrow("provider-outcome-uncertain");
    expect(count).toHaveBeenCalledTimes(1); expect(generate).toHaveBeenCalledTimes(1);
  });
});
it("cannot count the same prepared candidate again after a known failure or overlapping caller", async () => {
  const prepared = buildEngagementMessagesBody(input());
  const count = vi.fn(async () => '{"input_tokens":19000}'), generate = vi.fn();
  await expect(executeEngagementMessages(prepared, { perTaskTokens: 20_000, contextTokens: 20_000 }, { count, generate })).rejects.toThrow("token-limit");
  await expect(executeEngagementMessages(prepared, { perTaskTokens: 20_000, contextTokens: 20_000 }, { count, generate })).rejects.toThrow("already-started");
  expect(count).toHaveBeenCalledTimes(1); expect(generate).not.toHaveBeenCalled();
});
it("refuses a response reporting a different model before accepting its critique", async () => {
  const value = reply(); value.model = "different-model";
  await expect(executeEngagementMessages(buildEngagementMessagesBody(input()), { perTaskTokens: 20000, contextTokens: 40960 }, {
    count: async () => JSON.stringify({ input_tokens: 100 }), generate: async () => JSON.stringify(value),
  })).rejects.toThrow("engagement-present-messages-response-model-changed");
});

it("accepts only the source-proven content addressed DMR bundle label for the pinned model", () => {
  const value = reply(); value.model = "/root/.docker/model-runner/models/bundles/sha256/" + "a".repeat(64) + "/model/model.gguf";
  expect(parseEngagementMessagesReply(JSON.stringify(value), { inputTokens: 100, maxOutputTokens: 2048, expectedModel: input().modelDigest }))
    .toMatchObject({ responseModelIdentity: "dmr-content-addressed-bundle-v1" });
  for (const model of [value.model.replace("a".repeat(64), "b".repeat(64)), value.model.replace("model.gguf", "mmproj-F16.gguf"),
    "model.gguf", value.model.replace("/models/", "/../models/")]) {
    expect(() => parseEngagementMessagesReply(JSON.stringify({ ...value, model }), { inputTokens: 100, maxOutputTokens: 2048, expectedModel: input().modelDigest }))
      .toThrow("engagement-present-messages-response-model-changed");
  }
});
