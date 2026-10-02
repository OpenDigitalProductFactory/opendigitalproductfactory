import type { GeographicStyleTokens } from "@dpf/types";

/** The CSS custom properties each map style token is read from on the web. */
export const GEOGRAPHIC_TOKEN_VARIABLES: Record<keyof GeographicStyleTokens, string> = {
  background: "--dpf-bg",
  surface: "--dpf-surface-2",
  text: "--dpf-text",
  muted: "--dpf-muted",
  border: "--dpf-border",
  accent: "--dpf-accent",
};
