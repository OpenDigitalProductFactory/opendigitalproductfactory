import { describe, expect, it } from "vitest";

import { hasImplementationChange } from "./implementation-change";

describe("hasImplementationChange", () => {
  it.each([
    { reason: "empty change", paths: [], expected: false },
    { reason: "root docs directory", paths: ["docs/superpowers/specs/example.ts"], expected: false },
    { reason: "root documentation directory", paths: ["documentation/sample.json"], expected: false },
    { reason: "prose outside docs", paths: ["packages/example/README.MDX"], expected: false },
    { reason: "docs viewer component", paths: ["apps/web/components/docs/Article.tsx"], expected: true },
    { reason: "docs API route", paths: ["apps/web/app/api/docs/route.ts"], expected: true },
    { reason: "docs viewer library", paths: ["apps/web/lib/docs/parser.ts"], expected: true },
    { reason: "generated docs index", paths: ["apps/web/lib/docs/doc-index.generated.json"], expected: false },
    { reason: "generated diagram assets", paths: ["apps/web/lib/docs/diagram-versions.generated.mjs"], expected: false },
    { reason: "executable publication tooling", paths: ["docs/architecture/generate-docx-from-markdown.mjs"], expected: true },
    { reason: "mixed prose and source", paths: ["docs/architecture/design.md", "apps/web/lib/main.ts"], expected: true },
    { reason: "malformed path alongside source", paths: ["../docs/example.md", "apps/web/lib/main.ts"], expected: false },
    { reason: "unknown artifact", paths: ["docs-backup/archive.bin"], expected: false },
  ])("classifies $reason", ({ paths, expected }) => {
    expect(hasImplementationChange(paths)).toBe(expected);
  });
});
