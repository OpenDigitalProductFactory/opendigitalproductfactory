// apps/web/lib/safe-render.ts
// Safely convert any value to a React-renderable string.
// Prevents React error #31 ("Objects are not valid as a React child")
// when AI-generated JSON fields contain nested objects instead of strings.

export function safeRenderValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((v) => safeRenderValue(v)).join(", ");
  }
  // Object — render as human-readable sections instead of raw JSON
  if (typeof value === "object") {
    return formatObjectHuman(value as Record<string, unknown>);
  }
  return String(value);
}

/**
 * Format a nested object as human-readable text with section headers.
 * Handles the common AI pattern of { category: string[] } structures
 * (e.g., dataNeeds with api, pages, userFlow, dataModel arrays).
 */
function formatObjectHuman(obj: Record<string, unknown>): string {
  const sections: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).trim();
    if (Array.isArray(val)) {
      sections.push(`${label}:\n${val.map((v) => `  - ${safeRenderValue(v)}`).join("\n")}`);
    } else if (typeof val === "object" && val !== null) {
      sections.push(`${label}:\n${formatObjectHuman(val as Record<string, unknown>)}`);
    } else {
      sections.push(`${label}: ${safeRenderValue(val)}`);
    }
  }
  return sections.join("\n\n");
}
