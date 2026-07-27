import fs from "node:fs";

/**
 * Give an SVG with a viewBox explicit intrinsic dimensions.
 *
 * Mermaid CLI emits width="100%" without a height. That is responsive when the
 * SVG is inline, but an HTML <img> can fall back to the wrong intrinsic aspect
 * ratio and stretch a short diagram into a very tall image. Numeric dimensions
 * preserve the viewBox ratio; the portal's max-width/height-auto styles still
 * scale the image responsively.
 */
export function normalizeDocDiagramSvg(svg) {
  const opening = String(svg).match(/^<svg\b[^>]*>/)?.[0];
  if (!opening) return String(svg);

  const viewBox = opening.match(/\bviewBox="([^"]+)"/)?.[1];
  if (!viewBox) return String(svg);

  const parts = viewBox.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite) || parts[2] <= 0 || parts[3] <= 0) {
    return String(svg);
  }

  let normalized = opening;
  const width = String(parts[2]);
  const height = String(parts[3]);
  normalized = /\bwidth="[^"]*"/.test(normalized)
    ? normalized.replace(/\bwidth="[^"]*"/, `width="${width}"`)
    : normalized.replace("<svg", `<svg width="${width}"`);
  normalized = /\bheight="[^"]*"/.test(normalized)
    ? normalized.replace(/\bheight="[^"]*"/, `height="${height}"`)
    : normalized.replace("<svg", `<svg height="${height}"`);

  return String(svg).replace(opening, normalized);
}

export function hasIntrinsicDocDiagramSize(svg) {
  const opening = String(svg).match(/^<svg\b[^>]*>/)?.[0] ?? "";
  return /\bwidth="\d+(?:\.\d+)?"/.test(opening) && /\bheight="\d+(?:\.\d+)?"/.test(opening);
}

/**
 * Normalize one existing SVG without a pathname-based check/read/write race.
 *
 * Once opened, every operation targets the same descriptor even if another
 * process replaces the directory entry. A missing file is reported to the
 * caller so it can render the asset from source.
 */
export function normalizeDocDiagramSvgFile(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDWR);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }

  try {
    const current = fs.readFileSync(fd, "utf8");
    const normalized = normalizeDocDiagramSvg(current);
    if (normalized !== current) {
      fs.writeSync(fd, normalized, 0, "utf8");
      fs.ftruncateSync(fd, Buffer.byteLength(normalized));
    }
    return true;
  } finally {
    fs.closeSync(fd);
  }
}
