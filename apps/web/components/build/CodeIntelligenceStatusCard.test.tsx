import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { CodeIntelligenceStatusCard } from "./CodeIntelligenceStatusCard";
import type { CodeGraphFreshness } from "@/lib/integrate/code-graph-access";

function freshness(overrides: Partial<CodeGraphFreshness> = {}): CodeGraphFreshness {
  return {
    graphKey: "source-code",
    available: true,
    indexStatus: "ready",
    lastIndexedAt: new Date("2026-05-13T01:30:00Z"),
    lastIndexedBranch: "my-changes",
    lastIndexedHeadSha: "f5cfa13b044b0000000000000000000000000000",
    workspaceDirty: false,
    indexedFileCount: 2756,
    lastError: null,
    warnings: [],
    summary: "Code graph is ready for 2756 indexed files.",
    ...overrides,
  };
}

describe("CodeIntelligenceStatusCard", () => {
  it("renders ready graph status with source branch and commit", () => {
    const html = renderToStaticMarkup(<CodeIntelligenceStatusCard freshness={freshness()} />);

    expect(html).toContain("Code intelligence");
    expect(html).toContain("ready");
    expect(html).toContain("2,756 files");
    expect(html).toContain("my-changes");
    expect(html).toContain("f5cfa13b044b");
    expect(html).toContain("code-intelligence-status-card");
  });

  it("renders missing graph state", () => {
    const html = renderToStaticMarkup(
      <CodeIntelligenceStatusCard
        freshness={freshness({
          available: false,
          indexStatus: "missing",
          lastIndexedAt: null,
          lastIndexedBranch: null,
          lastIndexedHeadSha: null,
          indexedFileCount: 0,
          warnings: ["The code graph has not been built yet."],
        })}
      />,
    );

    expect(html).toContain("missing");
    expect(html).toContain("The code graph has not been built yet.");
  });

  it("renders dirty workspace warning", () => {
    const html = renderToStaticMarkup(
      <CodeIntelligenceStatusCard
        freshness={freshness({
          workspaceDirty: true,
          warnings: ["Uncommitted local changes may not be reflected in graph-backed analysis."],
        })}
      />,
    );

    expect(html).toContain("Uncommitted local changes");
  });
});
