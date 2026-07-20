// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProviderSuitabilityGuide } from "./ProviderSuitabilityGuide";

afterEach(cleanup);

describe("ProviderSuitabilityGuide", () => {
  it("hands the explanation to the canonical COO route", () => {
    const events: CustomEvent[] = [];
    const handler = (event: Event) => events.push(event as CustomEvent);
    document.addEventListener("open-agent-panel", handler);

    render(<ProviderSuitabilityGuide recommendation={{
      status: "review-needed",
      headline: "Keep company data out until account terms are confirmed",
      useNow: [],
      useAfterReview: [],
      notForThisWork: [],
      whatMayLeave: "Public prompts",
      whatStaysLocal: "Secrets",
      whatDpfBlocks: "Company data",
      nextAction: "Choose a business account.",
      caveat: "Local is not automatically compliant.",
      workloadClasses: ["public-marketing"],
    }} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask my COO to explain" }));

    document.removeEventListener("open-agent-panel", handler);
    expect(events).toHaveLength(1);
    expect(events[0]?.detail.routeContext).toBe("/workspace");
    expect(events[0]?.detail.autoMessage).toContain("Consult AGT-902");
  });
});
