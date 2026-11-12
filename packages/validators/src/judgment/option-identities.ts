export type OptionIdentityError = {
  index: number;
  field: "id" | "description";
  detail: string;
};

/**
 * Validate the identity fields the tool's own inputSchema marks required.
 *
 * A duplicate id is refused on the same grounds as a missing one: it collapses
 * identically, and the caller cannot tell which option the surviving row
 * describes.
 */
export function validateOptionIdentities(optionsParam: unknown[]): OptionIdentityError[] {
  const errors: OptionIdentityError[] = [];
  const seen = new Map<string, number>();
  optionsParam.forEach((raw, index) => {
    if (typeof raw !== "object" || raw === null) {
      errors.push({
        index,
        field: "id",
        detail: `option ${index} is not an object, so it carries no identity.`,
      });
      return;
    }
    const o = raw as Record<string, unknown>;
    const id = typeof o["id"] === "string" ? o["id"].trim() : "";
    if (id === "") {
      errors.push({
        index,
        field: "id",
        detail:
          `option ${index} has no \`id\`. Every option needs a stable, distinct \`id\` — ` +
          `the scores, the recommendation and the evidence map are all keyed on it` +
          (Object.keys(o).length > 0 ? `. Keys present: ${Object.keys(o).join(", ")}.` : "."),
      });
    } else if (seen.has(id)) {
      errors.push({
        index,
        field: "id",
        detail: `option ${index} reuses the \`id\` "${id}" already used by option ${seen.get(id)}; ids must be distinct.`,
      });
    } else {
      seen.set(id, index);
    }
    if (typeof o["description"] !== "string" || o["description"].trim() === "") {
      errors.push({
        index,
        field: "description",
        detail:
          `option ${index}${id ? ` ("${id}")` : ""} has no \`description\`; it is what the ` +
          `semantic path scores when an option carries no features.`,
      });
    }
  });
  return errors;
}
