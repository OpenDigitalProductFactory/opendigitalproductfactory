// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UnifiedEvidenceTimeline } from "./UnifiedEvidenceTimeline";

describe("UnifiedEvidenceTimeline", () => {
  it("labels external and local integration evidence by source", () => {
    render(
      <UnifiedEvidenceTimeline
        events={[
          { id: "1", source: "codex", label: "Codex", summary: "Unit tests passed." },
          { id: "2", source: "local-integration", label: "Local integration", summary: "Merged-code gate passed." },
        ]}
      />,
    );

    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("Local integration")).toBeInTheDocument();
    expect(screen.queryByText(/ExternalEvidenceRecord/i)).toBeNull();
    expect(screen.queryByText(/ToolExecutionReceipt/i)).toBeNull();
  });
});
