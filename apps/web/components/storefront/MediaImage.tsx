// Shared storefront image component. Renders a media URL with a focal-point crop
// (object-position) and an optional dominant-colour placeholder background so the
// layout doesn't jump before the image paints (LQIP). When there is no image it
// renders a generated SVG placeholder (a tinted box with the subject's initial),
// so fresh installs and empty galleries always render something rather than a
// blank gap. A plain <img> keeps it usable in server components and inside the
// existing inline-styled storefront.

import type { CSSProperties } from "react";

// Width ladder served by GET /api/media/:id?w= — must match RENDITION_WIDTHS.
const SRCSET_WIDTHS = [160, 320, 640, 960, 1280];

export interface MediaImageProps {
  src: string | null | undefined;
  alt: string;
  height?: number | string;
  width?: number | string;
  /** 0..1 focal point so important content survives the crop (Booqable-style). */
  focalX?: number | null;
  focalY?: number | null;
  /** Hex placeholder shown behind the image while it loads. */
  placeholderColor?: string | null;
  radius?: number;
  /** Responsive sizes hint; only used when the src is a managed media URL. */
  sizes?: string;
  style?: CSSProperties;
}

/** Deterministic pleasant background hue from a string (no Math.random). */
function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

function placeholderDataUri(seed: string): string {
  const hue = hueFor(seed || "?");
  const initial = (seed.trim()[0] ?? "?").toUpperCase();
  const bg = `hsl(${hue} 45% 88%)`;
  const fg = `hsl(${hue} 40% 45%)`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="${bg}"/><text x="200" y="150" dy="0.35em" text-anchor="middle" font-family="system-ui,sans-serif" font-size="120" font-weight="600" fill="${fg}">${initial}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Build a srcset over the rendition ladder for a managed /api/media/:id URL. */
function buildSrcSet(src: string): string | undefined {
  if (!src.startsWith("/api/media/")) return undefined;
  const join = src.includes("?") ? "&" : "?";
  return SRCSET_WIDTHS.map((w) => `${src}${join}w=${w} ${w}w`).join(", ");
}

export function MediaImage({
  src,
  alt,
  height = 160,
  width = "100%",
  focalX,
  focalY,
  placeholderColor,
  radius = 4,
  sizes = "(max-width: 640px) 100vw, 320px",
  style,
}: MediaImageProps) {
  const objectPosition =
    focalX != null && focalY != null
      ? `${Math.round(focalX * 100)}% ${Math.round(focalY * 100)}%`
      : "center";

  const resolvedSrc = src || placeholderDataUri(alt);
  const srcSet = src ? buildSrcSet(src) : undefined;

  return (
    <img
      src={resolvedSrc}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      loading="lazy"
      style={{
        width,
        height,
        objectFit: "cover",
        objectPosition,
        borderRadius: radius,
        backgroundColor: placeholderColor ?? "var(--dpf-border)",
        ...style,
      }}
    />
  );
}
