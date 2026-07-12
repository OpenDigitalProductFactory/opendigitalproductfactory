// Propose-N visual directions — the official replacement for temperature-driven
// design variety.
//
// BI-66656F61 (EP-F7E35344). Modern Claude models have a persistent default
// "house style"; sampling-temperature variety was removed on Opus 4.7+/Sonnet 5.
// Anthropic's sanctioned substitute for a NET-NEW UI surface is: have the model
// PROPOSE N concrete visual directions (background + accent + typeface +
// rationale) and gate implementation on a pick, rather than letting it converge
// on one default. This module produces those directions as ideate/UX-fit
// evidence so a human (or the UX-fit gate) chooses before a pixel is built.
//
// Pure structure + injected inference (unit-testable with a fake llm).

export type VisualDirection = {
  /** Short name, e.g. "Calm operator". */
  name: string;
  /** Background hex or DPF surface token. */
  background: string;
  /** Accent hex or DPF accent token. */
  accent: string;
  /** Typeface pairing, e.g. "Inter / Source Serif". */
  typeface: string;
  /** One-sentence rationale — why this fits the surface. */
  rationale: string;
};

export type DesignDirectionsResult = {
  surface: string;
  directions: VisualDirection[];
};

export type DesignDirectionsDeps = {
  llm: (prompt: string) => Promise<string>;
  /** How many directions to request (2-4 is the useful range). Default 3. */
  count?: number;
};

const firstJsonArray = (raw: string): unknown[] => {
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

function coerceDirection(v: unknown): VisualDirection | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const name = String(o.name ?? "").trim();
  const background = String(o.background ?? "").trim();
  const accent = String(o.accent ?? "").trim();
  const typeface = String(o.typeface ?? "").trim();
  const rationale = String(o.rationale ?? "").trim();
  if (!name || !background || !accent) return null;
  return { name, background, accent, typeface, rationale };
}

/** Build the propose-N-directions prompt for a net-new UI surface. */
export function buildDirectionsPrompt(surface: string, count: number): string {
  return `Propose ${count} DISTINCT visual directions for this net-new UI surface: "${surface}". Make them genuinely different in mood — do not converge on one default. For each, give a concrete background color, a concrete accent color (hex, or a DPF token like var(--dpf-accent) for platform UI), a typeface pairing, and a one-sentence rationale for why it fits this surface.

Respond with ONLY a JSON array of ${count} objects: [{"name":"","background":"","accent":"","typeface":"","rationale":""}]`;
}

/**
 * Propose N distinct visual directions for a net-new UI surface. Returns only
 * the well-formed directions (a direction missing name/background/accent is
 * dropped). Deterministic given the injected llm output.
 */
export async function proposeVisualDirections(
  surface: string,
  deps: DesignDirectionsDeps,
): Promise<DesignDirectionsResult> {
  const count = Math.min(Math.max(deps.count ?? 3, 2), 4);
  const raw = await deps.llm(buildDirectionsPrompt(surface, count));
  const directions = firstJsonArray(raw)
    .map(coerceDirection)
    .filter((d): d is VisualDirection => d !== null);
  return { surface, directions };
}

/** Render directions as a compact markdown block for the ideate / UX-fit trail. */
export function formatDesignDirections(result: DesignDirectionsResult): string {
  if (result.directions.length === 0) {
    return `### Visual directions — ${result.surface}\n\nNo well-formed directions were proposed; fall back to DPF default tokens.`;
  }
  const lines = [`### Visual directions — ${result.surface} (pick one before building)`, ""];
  result.directions.forEach((d, i) => {
    lines.push(`${i + 1}. **${d.name}** — bg \`${d.background}\`, accent \`${d.accent}\`, type ${d.typeface || "(default)"}. ${d.rationale}`);
  });
  return lines.join("\n");
}
