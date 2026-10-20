/** Bound traversal before a recursive schema can encounter hostile depth/cycles. */
export function isBoundedTrustedJson(value: unknown): boolean {
  const stack = [{ value, depth: 0 }];
  let nodes = 0; let characters = 0;
  try {
    while (stack.length) {
      const entry = stack.pop()!; const v = entry.value;
      if (++nodes > 20000 || entry.depth > 16) return false;
      if (v === null || typeof v === "boolean") continue;
      if (typeof v === "number") { if (!Number.isFinite(v)) return false; continue; }
      if (typeof v === "string") { characters += v.length; if (characters > 1048576) return false; continue; }
      if (typeof v !== "object") return false;
      if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return false;
      // Aliased objects are allowed; a cycle is rejected by the depth ceiling.
      const entries = Object.entries(Object.getOwnPropertyDescriptors(v));
      if (entries.length > 20000 || Object.getOwnPropertySymbols(v).length) return false;
      if (Array.isArray(v) && (entries.length !== v.length + 1 || entries.some(([key]) => key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key)))) return false;
      for (const [key, property] of entries) {
        if (Array.isArray(v) && key === "length") continue;
        if (!property.enumerable || !("value" in property)) return false;
        characters += key.length; if (characters > 1048576) return false;
        stack.push({ value: property.value, depth: entry.depth + 1 });
      }
    }
    return true;
  } catch { return false; }
}
