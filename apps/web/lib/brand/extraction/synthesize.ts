import type { BrandDesignSystem } from "../types";

const SYSTEM_PROMPT = `You are a brand design-system assistant. Given a partially-extracted BrandDesignSystem and a list of gaps (missing or low-confidence fields), return ONLY a JSON object with your best guesses for the gap fields. Use the existing fields (company name, primary color, fonts, component library) as context for your guesses. Return plausible defaults for any field you can infer, and leave fields you cannot confidently infer as null. Output strict JSON matching BrandDesignSystem shape, with only the fields you're filling in.`;

function buildUserPrompt(system: BrandDesignSystem): string {
  return `Current design system:
${JSON.stringify(
  {
    identity: system.identity,
    palette: {
      primary: system.palette.primary,
      secondary: system.palette.secondary,
      accents: system.palette.accents,
    },
    typography: { families: system.typography.families },
    components: { library: system.components.library, count: system.components.inventory.length },
  },
  null,
  2,
)}

Gaps to fill:
${system.gaps.map((g) => `- ${g}`).join("\n")}

Return JSON with just the fields you are filling.`;
}

type ProviderResponse = {
  result?: { content?: string };
  content?: string;
};

function extractContent(raw: ProviderResponse | null | undefined): string | null {
  if (!raw) return null;
  return raw.result?.content ?? raw.content ?? null;
}

export async function synthesize(
  system: BrandDesignSystem,
): Promise<BrandDesignSystem> {
  if (!system.gaps || system.gaps.length === 0) {
    return system;
  }

  let aiContent: string | null = null;
  try {
    const { callWithFailover } = await import("@/lib/inference/ai-provider-priority");
    const response = await callWithFailover(
      [{ role: "user", content: buildUserPrompt(system) }],
      SYSTEM_PROMPT,
      "internal",
      { task: "analysis" },
    );
    aiContent = extractContent(response as ProviderResponse);
  } catch {
    return {
      ...system,
      gaps: [...system.gaps, "synthesizer-failed"],
    };
  }

  if (!aiContent) {
    return {
      ...system,
      gaps: [...system.gaps, "synthesizer-empty"],
    };
  }

  let parsed: Partial<BrandDesignSystem> | null = null;
  try {
    parsed = JSON.parse(aiContent) as Partial<BrandDesignSystem>;
  } catch {
    return {
      ...system,
      gaps: [...system.gaps, "synthesizer-invalid-json"],
    };
  }

  const result: BrandDesignSystem = { ...system };
  const perField = { ...system.confidence.perField };

  if (parsed.identity) {
    const id = parsed.identity;
    if (id.tagline && !result.identity.tagline) {
      result.identity = { ...result.identity, tagline: id.tagline };
      perField["identity.tagline"] = 0.4;
    }
    if (id.description && !result.identity.description) {
      result.identity = { ...result.identity, description: id.description };
      perField["identity.description"] = 0.4;
    }
    if (id.voice) {
      result.identity = { ...result.identity, voice: id.voice };
      perField["identity.voice"] = 0.3;
    }
  }

  if (parsed.palette) {
    if (parsed.palette.secondary && !result.palette.secondary) {
      result.palette = { ...result.palette, secondary: parsed.palette.secondary };
      perField["palette.secondary"] = 0.4;
    }
    if (parsed.palette.accents && parsed.palette.accents.length > 0 && result.palette.accents.length === 0) {
      result.palette = { ...result.palette, accents: parsed.palette.accents };
      perField["palette.accents"] = 0.4;
    }
  }

  if (parsed.typography?.pairings && parsed.typography.pairings.length > 0) {
    result.typography = { ...result.typography, pairings: parsed.typography.pairings };
    perField["typography.pairings"] = 0.3;
  }

  result.confidence = { ...result.confidence, perField };
  result.gaps = [];

  return result;
}
