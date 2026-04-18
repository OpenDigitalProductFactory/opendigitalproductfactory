export type BrandDesignSystemVersion = "1.0.0";

export type AssetRef = {
  url: string;
  source: "upload" | "scraped" | "codebase" | "derived";
  mimeType?: string;
  width?: number;
  height?: number;
};

export type ExtractionSource = {
  kind: "codebase" | "url" | "upload";
  ref: string;
  capturedAt: string;
};

export type NeutralScale = {
  50: string; 100: string; 200: string; 300: string; 400: string;
  500: string; 600: string; 700: string; 800: string; 900: string; 950: string;
};

export type Palette = {
  primary: string;
  secondary: string | null;
  accents: string[];
  semantic: { success: string; warning: string; danger: string; info: string };
  neutrals: NeutralScale;
  surfaces: { background: string; foreground: string; muted: string; card: string; border: string };
};

export type TypographyEntry = {
  size: string;
  lineHeight: string;
  tracking: string;
  weight: number;
};

export type TypographyScale = Record<
  "xs" | "sm" | "base" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl" | "6xl",
  TypographyEntry
>;

export type Typography = {
  families: { sans: string; serif: string | null; mono: string; display: string | null };
  scale: TypographyScale;
  pairings: Array<{ heading: string; body: string }>;
};

export type ComponentCatalogEntry = {
  name: string;
  variants: string[];
  anchorFile: string | null;
  tokens: Record<string, string>;
};

export type PatternEntry = {
  name: "hero" | "nav" | "card" | "footer" | "form" | string;
  anchorFile: string | null;
};

export type ComponentInventory = {
  library: "shadcn" | "mui" | "custom" | "unknown";
  inventory: ComponentCatalogEntry[];
  patterns: PatternEntry[];
};

export type DesignTokens = {
  radii: Record<string, string>;
  spacing: Record<string, string>;
  shadows: Record<string, string>;
  motion: Record<string, string>;
  breakpoints: Record<string, string>;
};

export type Identity = {
  name: string;
  tagline: string | null;
  description: string | null;
  logo: { darkBg: AssetRef | null; lightBg: AssetRef | null; mark: AssetRef | null };
  voice: { tone: string; sampleCopy: string[] };
};

export type BrandDesignSystem = {
  version: BrandDesignSystemVersion;
  extractedAt: string;
  sources: ExtractionSource[];
  identity: Identity;
  palette: Palette;
  typography: Typography;
  components: ComponentInventory;
  tokens: DesignTokens;
  confidence: {
    overall: number;
    perField: Record<string, number>;
  };
  gaps: string[];
  overrides: Partial<Omit<BrandDesignSystem, "version" | "overrides">>;
};

export function isBrandDesignSystem(value: unknown): value is BrandDesignSystem {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === "1.0.0" &&
    typeof v.extractedAt === "string" &&
    Array.isArray(v.sources) &&
    typeof v.identity === "object" &&
    typeof v.palette === "object" &&
    typeof v.typography === "object" &&
    typeof v.components === "object" &&
    typeof v.tokens === "object" &&
    typeof v.confidence === "object" &&
    Array.isArray(v.gaps)
  );
}
