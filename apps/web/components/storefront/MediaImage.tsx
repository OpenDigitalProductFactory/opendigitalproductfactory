// Shared storefront image component. Renders a media URL with a focal-point crop
// (object-position) and an optional dominant-colour placeholder background so the
// layout doesn't jump before the image paints (LQIP). A plain <img> keeps it
// usable in server components and inside the existing inline-styled storefront.

import type { CSSProperties } from "react";

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
  style?: CSSProperties;
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
  style,
}: MediaImageProps) {
  if (!src) return null;
  const objectPosition =
    focalX != null && focalY != null
      ? `${Math.round(focalX * 100)}% ${Math.round(focalY * 100)}%`
      : "center";

  return (
    <img
      src={src}
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
