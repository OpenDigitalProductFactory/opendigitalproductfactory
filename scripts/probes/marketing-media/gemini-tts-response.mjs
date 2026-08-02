const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const MAX_AUDIO_BASE64_LENGTH = Math.ceil(MAX_AUDIO_BYTES / 3) * 4;
const MAX_RESPONSE_BYTES = MAX_AUDIO_BASE64_LENGTH + 64 * 1024;
const MAX_TRAVERSED_VALUES = 512;

const AUDIO_FORMATS = new Map([
  ["audio/wav", { mimeType: "audio/wav", extension: "wav" }],
  ["audio/l16;codec=pcm;rate=24000", { mimeType: "audio/L16;codec=pcm;rate=24000", extension: "pcm" }],
]);

const USAGE_FIELDS = [
  "inputTokenCount",
  "outputTokenCount",
  "totalTokenCount",
  "promptTokenCount",
  "candidatesTokenCount",
];

function findAudioCandidate(payload) {
  const pending = [payload];
  const visited = new Set();

  while (pending.length > 0 && visited.size < MAX_TRAVERSED_VALUES) {
    const value = pending.shift();
    if (!value || typeof value !== "object" || visited.has(value)) continue;
    visited.add(value);

    const data = typeof value.data === "string" ? value.data : null;
    const claimedMimeType = typeof value.mimeType === "string"
      ? value.mimeType
      : typeof value.mime_type === "string"
        ? value.mime_type
        : null;
    if (data && claimedMimeType && AUDIO_FORMATS.has(claimedMimeType.toLowerCase())) {
      return { data, format: AUDIO_FORMATS.get(claimedMimeType.toLowerCase()) };
    }

    pending.push(...(Array.isArray(value) ? value : Object.values(value)));
  }

  return null;
}

function decodeCanonicalBase64(encoded) {
  if (encoded.length > MAX_AUDIO_BASE64_LENGTH) {
    throw new Error("Gemini audio exceeds the maximum encoded size");
  }
  if (encoded.length === 0 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error("Gemini audio is not canonical base64");
  }

  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0 || bytes.length > MAX_AUDIO_BYTES || bytes.toString("base64") !== encoded) {
    throw new Error("Gemini audio is not canonical base64");
  }
  return bytes;
}

export function decodeGeminiAudio(payload) {
  const candidate = findAudioCandidate(payload);
  if (!candidate) throw new Error("Gemini response does not contain a supported audio payload");

  const bytes = decodeCanonicalBase64(candidate.data);
  if (candidate.format.extension === "wav") {
    const isWave = bytes.length >= 12
      && bytes.subarray(0, 4).toString("ascii") === "RIFF"
      && bytes.subarray(8, 12).toString("ascii") === "WAVE";
    if (!isWave) throw new Error("Gemini audio does not contain a valid WAV container header");
  } else if (bytes.length % 2 !== 0) {
    throw new Error("Gemini audio does not contain complete 16-bit PCM samples");
  }

  return { ...candidate.format, bytes };
}

export function extractGeminiUsage(payload) {
  const source = payload?.usageMetadata ?? payload?.usage_metadata;
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};

  return Object.fromEntries(USAGE_FIELDS.flatMap((field) => {
    const value = source[field];
    return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000 ? [[field, value]] : [];
  }));
}

export async function readBoundedJsonResponse(response, byteLimit = MAX_RESPONSE_BYTES) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > byteLimit) {
    throw new Error("Gemini response exceeds the maximum response size");
  }
  if (!response.body) throw new Error("Gemini response has no body");

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > byteLimit) {
        await reader.cancel("response-size-limit");
        throw new Error("Gemini response exceeds the maximum response size");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return JSON.parse(Buffer.concat(chunks, totalBytes).toString("utf8"));
}
