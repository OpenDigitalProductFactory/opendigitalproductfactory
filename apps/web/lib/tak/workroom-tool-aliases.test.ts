import { describe, expect, it } from "vitest";
import { canonicalWorkroomToolName, WORKROOM_TOOL_ALIASES } from "./workroom-tool-aliases";

describe("Workroom compatibility names", () => {
  it.each(Object.entries(WORKROOM_TOOL_ALIASES))("resolves %s once and keeps its canonical name stable", (alias, canonical) => {
    expect(canonicalWorkroomToolName(alias)).toBe(canonical);
    expect(canonicalWorkroomToolName(canonical)).toBe(canonical);
  });
  it.each(["__proto__", "constructor", "toString", "not_a_tool"])("does not treat %s as an alias", (name) => {
    expect(canonicalWorkroomToolName(name)).toBe(name);
  });
});
