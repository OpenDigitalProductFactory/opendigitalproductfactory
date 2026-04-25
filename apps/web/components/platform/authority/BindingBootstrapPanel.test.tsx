import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { BindingBootstrapPanel } from "./BindingBootstrapPanel";

describe("BindingBootstrapPanel", () => {
  it("renders first-run bootstrap guidance and low-confidence review items", () => {
    const html = renderToStaticMarkup(
      <BindingBootstrapPanel
        autoApplied
        report={{
          created: 3,
          skippedExisting: 0,
          wouldCreate: 0,
          candidates: [],
          lowConfidence: [
            { resourceRef: "/setup", agentId: "onboarding-coo", reason: "ungated-route" },
            { resourceRef: "/sandbox", agentId: "platform-engineer", reason: "missing-subjects" },
          ],
        }}
      />,
    );

    expect(html).toContain("Bootstrap coverage");
    expect(html).toContain("Auto-applied initial authority binding bootstrap");
    expect(html).toContain("/setup");
    expect(html).toContain("Route is not capability-gated yet");
    expect(html).toContain("Subject mapping could not be inferred");
  });

  it("renders empty-state guidance when there are still no bindings after review", () => {
    const html = renderToStaticMarkup(
      <BindingBootstrapPanel
        autoApplied={false}
        totalBindings={0}
        report={{
          created: 0,
          skippedExisting: 0,
          wouldCreate: 0,
          candidates: [],
          lowConfidence: [],
        }}
      />,
    );

    expect(html).toContain("No authority bindings are active yet");
    expect(html).toContain("Refresh inferred bindings");
  });
});
