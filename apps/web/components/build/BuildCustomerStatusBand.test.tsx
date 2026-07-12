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
