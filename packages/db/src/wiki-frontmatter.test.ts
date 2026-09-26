import { describe, expect, it } from "vitest";
import {
  deriveSlug,
  kernelWikiPageSlug,
  parseFrontmatter,
  professionCorpusPageSlug,
  type WikiPageFrontmatter,
} from "./wiki-frontmatter";

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

// BI-DEDAC950: the seeders' slug rules are exported so a cited slug can be
// checked against the page files by the same rule that seeds the DB.
describe("wiki page slug rules", () => {
  it("kernelWikiPageSlug prefers the frontmatter slug", () => {
    expect(
      kernelWikiPageSlug({ slug: "gates-proportional-to-shape" }, "/r/wiki/principles/x.md", "/r/wiki"),
    ).toBe("gates-proportional-to-shape");
  });

  it("kernelWikiPageSlug falls back to the path under the wiki dir", () => {
    expect(kernelWikiPageSlug({}, "/r/wiki/principles/never-fabricate.md", "/r/wiki")).toBe(
      "principles/never-fabricate",
    );
    expect(kernelWikiPageSlug({}, "C:\\r\\wiki\\principles\\a.md", "C:\\r\\wiki")).toBe("principles/a");
  });

  it("professionCorpusPageSlug strips the wiki segment and prefixes professions/", () => {
    expect(
      professionCorpusPageSlug(
        "/r/docs/professions/frontend-engineer/wiki/compose-report-kit-for-reporting-ux.md",
        "/r/docs/professions",
      ),
    ).toBe("professions/frontend-engineer/compose-report-kit-for-reporting-ux");
  });

  it("deriveSlug keeps its contract", () => {
    expect(deriveSlug("/repo/wiki/index.md", "/repo/wiki")).toBe("index");
  });
});
