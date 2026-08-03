import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeGeminiAudio,
  extractGeminiUsage,
  readBoundedJsonResponse,
} from "./gemini-tts-response.mjs";

const wavBytes = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([4, 0, 0, 0]),
  Buffer.from("WAVE", "ascii"),
  Buffer.from([1, 2, 3, 4]),
]);

test("accepts bounded WAV audio and returns a canonical local format", () => {
  const audio = decodeGeminiAudio({
    response: { inlineData: { mimeType: "audio/wav", data: wavBytes.toString("base64") } },
  });

  assert.equal(audio.mimeType, "audio/wav");
  assert.equal(audio.extension, "wav");
  assert.deepEqual(audio.bytes, wavBytes);
});

test("accepts Gemini's documented 24 kHz linear PCM response", () => {
  const bytes = Buffer.from([1, 2, 3, 4]);
  const audio = decodeGeminiAudio({
    inline_data: {
      mime_type: "audio/L16;codec=pcm;rate=24000",
      data: bytes.toString("base64"),
    },
  });

  assert.equal(audio.mimeType, "audio/L16;codec=pcm;rate=24000");
  assert.equal(audio.extension, "pcm");
  assert.deepEqual(audio.bytes, bytes);
});

test("rejects an arbitrary audio MIME type instead of trusting its file claim", () => {
  assert.throws(
    () => decodeGeminiAudio({ data: wavBytes.toString("base64"), mimeType: "audio/x-malicious" }),
    /supported audio payload/,
  );
});

test("rejects non-canonical base64 and oversized provider audio", () => {
  assert.throws(() => decodeGeminiAudio({ data: "not base64", mimeType: "audio/wav" }), /canonical base64/);
  assert.throws(
    () => decodeGeminiAudio({ data: "A".repeat(28_000_004), mimeType: "audio/wav" }),
    /maximum encoded size/,
  );
});

test("rejects content that does not match the declared WAV or PCM shape", () => {
  assert.throws(
    () => decodeGeminiAudio({ data: Buffer.from("not-a-wave").toString("base64"), mimeType: "audio/wav" }),
    /WAV container/,
  );
  assert.throws(
    () => decodeGeminiAudio({ data: Buffer.from([1, 2, 3]).toString("base64"), mimeType: "audio/L16;codec=pcm;rate=24000" }),
    /16-bit PCM/,
  );
});

test("usage receipts retain only bounded known integer counters", () => {
  const usage = extractGeminiUsage({
    usageMetadata: {
      inputTokenCount: 12,
      outputTokenCount: 34,
      totalTokenCount: 46,
      providerNote: "do not persist me",
      nested: { secret: "do not persist me either" },
    },
  });

  assert.deepEqual(usage, { inputTokenCount: 12, outputTokenCount: 34, totalTokenCount: 46 });
  assert.equal(JSON.stringify(usage).includes("persist"), false);
  assert.deepEqual(extractGeminiUsage({ usageMetadata: { totalTokenCount: -1 } }), {});
});

test("bounded response reader rejects oversized JSON before parsing", async () => {
  const response = new Response(JSON.stringify({ data: "x".repeat(128) }));
  await assert.rejects(() => readBoundedJsonResponse(response, 32), /maximum response size/);
});

test("bounded response reader parses a response within the limit", async () => {
  const response = new Response(JSON.stringify({ ok: true }));
  assert.deepEqual(await readBoundedJsonResponse(response, 32), { ok: true });
});
