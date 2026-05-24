import { describe, expect, it } from "vitest";
import { parseFrontmatter, type WikiPageFrontmatter } from "./wiki-frontmatter";

describe("parseFrontmatter — principleRuntimeEnforcement (inline JSON)", () => {
  it("parses a complete runtime-enforcement block authored as a single inline-JSON value", () => {
    const yaml =
      "---\n" +
      "title: Never wipe DB\n" +
      "pageKind: principle\n" +
      "principleTier: commandment\n" +
      'principleRuntimeEnforcement: {"interactiveMode":"confirm","autonomousMode":"refuse","patterns":[{"kind":"shell","regex":"^docker\\\\s+volume\\\\s+rm\\\\b","rationale":"wipes operator state"}]}\n' +
      "---\n" +
      "body";
    const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(yaml);
    expect(frontmatter.principleRuntimeEnforcement).toEqual({
      interactiveMode: "confirm",
      autonomousMode: "refuse",
      patterns: [
        {
          kind: "shell",
          regex: "^docker\\s+volume\\s+rm\\b",
          rationale: "wipes operator state",
        },
      ],
    });
  });

  it("leaves the field undefined when absent from the frontmatter", () => {
    const yaml = "---\ntitle: x\npageKind: principle\n---\nbody";
    const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(yaml);
    expect(frontmatter.principleRuntimeEnforcement).toBeUndefined();
  });

  it("supports multiple pattern kinds in a single block", () => {
    const yaml =
      "---\n" +
      "title: x\n" +
      "pageKind: principle\n" +
      "principleTier: commandment\n" +
      'principleRuntimeEnforcement: {"interactiveMode":"confirm","autonomousMode":"refuse","patterns":[{"kind":"shell","regex":"^x","rationale":"a"},{"kind":"sql","regex":"^DROP","rationale":"b"},{"kind":"mcp_tool","toolName":"reset_all","rationale":"c"},{"kind":"git","regex":"^push.*--force","rationale":"d"}]}\n' +
      "---\n" +
      "body";
    const { frontmatter } = parseFrontmatter<WikiPageFrontmatter>(yaml);
    expect(frontmatter.principleRuntimeEnforcement?.patterns).toHaveLength(4);
    expect(frontmatter.principleRuntimeEnforcement?.patterns.map((p) => p.kind)).toEqual([
      "shell",
      "sql",
      "mcp_tool",
      "git",
    ]);
  });
});
