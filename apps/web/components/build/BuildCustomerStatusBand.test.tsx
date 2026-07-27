import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BuildCustomerStatusBand } from "./BuildCustomerStatusBand";
import type { BuildStudioCustomerStatus } from "@/lib/build/customer-status-projection";

// BI-BB13B599 — render checks via renderToStaticMarkup (band-test convention).

function status(over: Partial<BuildStudioCustomerStatus> = {}): BuildStudioCustomerStatus {
  return {
    whatIsBeingBuilt: "Add invoicing",
    lifecyclePosition: "In progress",
    worker: "Work in progress",
    evidence: "Work capsule is actively executing.",
    nextAction: "continue implementation until verification evidence is ready.",
    owner: "Build Studio build agent",
    needsYou: false,
    ...over,
  };
}

describe("BuildCustomerStatusBand", () => {
  it("renders the plain lifecycle position and worker phrasing", () => {
    const html = renderToStaticMarkup(<BuildCustomerStatusBand status={status()} />);
    expect(html).toContain("In progress");
    expect(html).toContain("Work in progress");
  });

  it("keeps technical PR evidence behind progressive disclosure", () => {
    const html = renderToStaticMarkup(
      <BuildCustomerStatusBand
        status={{
          whatIsBeingBuilt: "Recover delivery",
          lifecyclePosition: "Merge queued",
          worker: "Repository merge queue",
          evidence: "Build Studio checked the current delivery state.",
          technicalEvidence: "PR #42 · head abc123 · observations 2",
          nextAction: "wait for the protected merge queue to finish.",
          owner: "Build Studio",
          needsYou: false,
        }}
      />,
    );
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).toContain("Technical delivery details");
    expect(html).toContain("PR #42");
  });

  it("renders evidence, next action, and owner for operational closeout", () => {
    const html = renderToStaticMarkup(<BuildCustomerStatusBand status={status()} />);
    expect(html).toContain("Evidence:");
    expect(html).toContain("Work capsule is actively executing.");
    expect(html).toContain("Next action:");
    expect(html).toContain("continue implementation until verification evidence is ready.");
    expect(html).toContain("Owner:");
    expect(html).toContain("Build Studio build agent");
  });

  it("shows the 'Needs you' pill only when the work needs the operator", () => {
    const withPill = renderToStaticMarkup(<BuildCustomerStatusBand status={status({ needsYou: true })} />);
    expect(withPill).toContain("Needs you");

    const withoutPill = renderToStaticMarkup(<BuildCustomerStatusBand status={status({ needsYou: false })} />);
    expect(withoutPill).not.toContain("Needs you");
  });

  it("never leaks an executor name — worker phrasing is business-safe", () => {
    const html = renderToStaticMarkup(<BuildCustomerStatusBand status={status()} />);
    expect(html).not.toMatch(/claude|codex|grok/i);
  });
});
