// Gemini modality derivation (BI-7C957749).
//
// adapter-gemini.ts hardcoded `inputModalities: ["text"]` and
// `outputModalities: ["text"]` for every model Google returns. Discovery was
// finding gemini-3-pro-image, nano-banana-pro-preview, veo-3.1-generate-preview
// and the tts/native-audio family, and every one of them landed in ModelProfile
// as text-only. Measured on the live install: 80 model profiles, ZERO carrying
// an image or video output modality, while DiscoveredModel held all of the
// above. Model selection could therefore never return a renderer, and no
// caller could ask for one.
//
// The other adapters already do this properly — adapter-ollama.ts derives via
// localOutputModalities(), adapter-openrouter.ts reads the architecture's
// declared output_modalities. Gemini was the outlier.
//
// Derivation is by model id because Google's list endpoint does not report
// output modality. The rules below are written against the ids actually present
// in this install's DiscoveredModel table rather than invented from docs, and
// every one of them is pinned in the tests.

const IMAGE_OUTPUT = /(^|-)image(-|$)|^nano-banana/;
const VIDEO_OUTPUT = /^veo-/;
const AUDIO_OUTPUT = /-tts(-|$)|native-audio/;
const EMBEDDING = /embedding/;
/**
 * Speech-to-TEXT. `transcribe` models take audio in and return text, so they
 * must not be swept up by the audio-output rule — getting this backwards would
 * advertise a transcriber as a speech generator.
 */
const TRANSCRIBE = /transcribe/;

/**
 * What a Gemini model can EMIT. Text is the floor: the conversational image
 * models return prose alongside the image, and a caller filtering for "image"
 * still finds them.
 */
export function geminiOutputModalities(modelId: string): string[] {
  const id = modelId.toLowerCase();

  if (EMBEDDING.test(id)) return ["embeddings"];
  if (VIDEO_OUTPUT.test(id)) return ["video"];
  if (IMAGE_OUTPUT.test(id)) return ["text", "image"];
  if (!TRANSCRIBE.test(id) && AUDIO_OUTPUT.test(id)) return ["text", "audio"];
  return ["text"];
}

/**
 * What a Gemini model can ACCEPT. Kept deliberately conservative: text is
 * always accepted, and the extra modalities are only claimed where the id says
 * so. An over-claimed input modality produces a request the provider rejects,
 * which is worse than routing around a capability we did not advertise.
 */
export function geminiInputModalities(modelId: string): string[] {
  const id = modelId.toLowerCase();

  if (EMBEDDING.test(id)) return ["text"];

  const mods = ["text"];
  // Transcription and the live/native-audio family take audio in.
  if (TRANSCRIBE.test(id) || /native-audio|-live(-|$)|^gemini-omni/.test(id)) mods.push("audio");
  // The image models are image-editing capable, so they accept an image too.
  if (IMAGE_OUTPUT.test(id)) mods.push("image");
  return mods;
}
