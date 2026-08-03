import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  decodeGeminiAudio,
  extractGeminiUsage,
  readBoundedJsonResponse,
} from "./gemini-tts-response.mjs";

const probeDir = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(probeDir, "outputs");
const receiptPath = resolve(probeDir, "gemini-tts-receipt.json");
const model = "gemini-3.1-flash-tts-preview";
const endpoint = `https://generativelanguage.googleapis.com/v1beta/interactions`;
const script = "Today is already moving. See the next decision, protect every promise, and give your team one clear place to act.";

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function saveReceipt(receipt) {
  // codeql[js/http-to-file-access]: Fixed-path JSON with locally constructed fields and allowlisted bounded counters.
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ receiptPath, status: receipt.status }));
}

const base = {
  schemaVersion: 1,
  kind: "marketing-media-cloud-tts",
  backlogItemId: "BI-0C891AC7",
  toolEvaluationId: "cmsb7di2h06za01tcrkp1q1jz",
  candidate: { provider: "Google Gemini", model },
  input: { classification: "synthetic-non-sensitive", scriptSha256: hash(script), characterCount: script.length },
};

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey || process.env.DPF_GEMINI_PAID_TIER_CONFIRMED !== "1") {
  await saveReceipt({
    ...base,
    status: "blocked_external_configuration",
    reason: !apiKey ? "paid-tier Gemini credential is not configured" : "paid-tier processing posture is not explicitly confirmed",
    requiredNextAction: "Configure a billed Gemini project through governed integration credentials, then rerun with DPF_GEMINI_PAID_TIER_CONFIRMED=1.",
  });
  process.exit(3);
}

await mkdir(outputDir, { recursive: true });
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 60_000);
const requestBody = {
  model,
  input: `Read this exact marketing narration in a warm, confident, unhurried voice. Do not add or remove words.\n\n${script}`,
  response_format: { type: "audio" },
  generation_config: { speech_config: [{ voice: "Kore" }] },
};
const started = performance.now();
let response;
try {
  response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(requestBody),
    signal: controller.signal,
  });
} finally {
  clearTimeout(timeout);
}
const latencyMs = Math.round(performance.now() - started);
let payload;
try {
  payload = await readBoundedJsonResponse(response);
} catch {
  await saveReceipt({ ...base, status: "invalid_provider_response", latencyMs });
  process.exit(1);
}

if (!response.ok) {
  await saveReceipt({
    ...base,
    status: "provider_error",
    latencyMs,
    httpStatusClass: response.status >= 500 ? "server_error" : response.status >= 400 ? "client_error" : "unexpected_status",
    error: "Gemini TTS request failed; inspect provider telemetry using the governed credential context.",
  });
  process.exit(1);
}

let audio;
try {
  audio = decodeGeminiAudio(payload);
} catch {
  await saveReceipt({ ...base, status: "invalid_provider_response", latencyMs });
  process.exit(1);
}

const outputPath = audio.extension === "wav"
  ? resolve(outputDir, "gemini-tts.wav")
  : resolve(outputDir, "gemini-tts.pcm");
// codeql[js/http-to-file-access]: Audio is bounded, canonical, format-allowlisted, and shape-validated before writing.
await writeFile(outputPath, audio.bytes);
await saveReceipt({
  ...base,
  status: "passed",
  latencyMs,
  output: { mimeType: audio.mimeType, bytes: audio.bytes.length, sha256: hash(audio.bytes) },
  usageMetadata: extractGeminiUsage(payload),
  provenance: { synthIdExpectedFromProviderPolicy: true, c2paManifestVerified: false },
  determinism: { guaranteed: false, rationale: "Generative TTS output is cached as an approved asset; prompt replay is not treated as byte deterministic." },
});
