import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BuildSolutionSummaryBand } from "./BuildSolutionSummaryBand";

// BI-90670010 — Band 1 ("What we're building") render checks. renderToStaticMarkup
// (node env) per the report-kit testing convention; no DOM needed.

describe("BuildSolutionSummaryBand", () => {
  it("renders the heading, problem statement, and approach", () => {
    const html = renderToStaticMarkup(
      <BuildSolutionSummaryBand
        problemStatement="A loyalty discount for repeat customers."
        proposedApproach="Apply 10% at checkout for customers with 5+ orders."
        fallbackIntent={null}
      />,
    );
    expect(html).toContain("What we");
    expect(html).toContain("A loyalty discount for repeat customers.");
    expect(html).toContain("Apply 10% at checkout for customers with 5+ orders.");
  });

  it("keeps technical implementation detail out of the operator summary", () => {
    const html = renderToStaticMarkup(
      <BuildSolutionSummaryBand
        problemStatement="Build Studio currently lets operators start a build that cannot run, which wastes time and creates confusion."
        proposedApproach={[
          "Data Model: Use existing configuration and runtime evidence.",
          "ModelProvider supplies whether a provider is active, inactive, local, remote, API-backed, or CLI-backed.",
          "BuildEngine supplies local opencode execution if the project chooses it.",
        ].join(" ")}
        fallbackIntent={null}
      />,
    );

    expect(html).toContain("Build Studio currently lets operators start a build");
    expect(html).toContain("AI Coworker has the technical plan");
    expect(html).not.toContain("Data Model");
    expect(html).not.toContain("ModelProvider");
    expect(html).not.toContain("BuildEngine");
  });

  it("falls back to the captured intent when no design doc exists yet", () => {
    const html = renderToStaticMarkup(
      <BuildSolutionSummaryBand
        problemStatement={null}
        proposedApproach={null}
        fallbackIntent="Add a way for customers to track their order."
      />,
    );
    expect(html).toContain("Add a way for customers to track their order.");
  });

  it("renders nothing when there is no intent at all", () => {
    const html = renderToStaticMarkup(
      <BuildSolutionSummaryBand
        problemStatement={null}
        proposedApproach={null}
        fallbackIntent={null}
      />,
    );
    expect(html).toBe("");
  });
});
