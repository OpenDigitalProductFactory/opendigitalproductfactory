// Normalise a logo's bytes into a safe, servable raster image — so the operator
// never has to know or care what format their logo is in.
//
// The one format that needs special handling is SVG: it's vector (great), but
// serving unsanitised SVG same-origin is a stored-XSS risk, and the generic
// raster MediaAsset path doesn't accept it. Rather than make the user convert it
// (or reason about "what is SVG"), we rasterise it to a PNG with sharp on their
// behalf. Everything else passes through untouched.

export type NormalizedImage = { content: Buffer; mimeType: string };

// Matches the proven idiom in renditions.ts: sharp ships `export = sharp`, so the
// callable factory is the module's `.default` under esModuleInterop.
type SharpFactory = typeof import("sharp").default;

// Target raster size for a rasterised vector logo — crisp on retina headers
// without being heavy. The serve route's ?w= renditions take it from here.
const RASTERIZE_WIDTH = 512;

function looksLikeSvg(content: Buffer, mimeType: string | null | undefined): boolean {
  if (mimeType && mimeType.toLowerCase().includes("svg")) return true;
  // Sniff: SVG starts with "<svg" or an XML prolog that contains "<svg".
  const head = content.subarray(0, 256).toString("utf-8").trimStart().toLowerCase();
  return head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"));
}

/**
 * Return raster bytes ready for createMediaAsset. SVG/vector input is rasterised
 * to PNG; raster input passes through. Returns null only when a vector logo
 * cannot be rasterised (sharp absent or render failure) — callers stay non-fatal.
 */
export async function normalizeLogoForStore(
  content: Buffer,
  mimeType: string | null | undefined,
): Promise<NormalizedImage | null> {
  if (!looksLikeSvg(content, mimeType)) {
    // Already a raster image — let createMediaAsset validate/probe it.
    return { content, mimeType: mimeType ?? "" };
  }

  // Rasterise the vector logo to a safe PNG on the user's behalf.
  let sharp: SharpFactory;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    return null;
  }
  try {
    const png = await sharp(content)
      .resize({ width: RASTERIZE_WIDTH, withoutEnlargement: true })
      .png()
      .toBuffer();
    return { content: png, mimeType: "image/png" };
  } catch {
    return null;
  }
}
