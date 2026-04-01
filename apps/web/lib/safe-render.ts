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
  // Object — pretty-print as JSON
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
