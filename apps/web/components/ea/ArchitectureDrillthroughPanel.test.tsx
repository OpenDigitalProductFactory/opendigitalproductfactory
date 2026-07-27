import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ArchitectureDrillthroughPanel } from "./ArchitectureDrillthroughPanel";

describe("ArchitectureDrillthroughPanel", () => {
  it("renders accessible related viewpoints and a privacy-safe decision explanation", () => {
    const html = renderToStaticMarkup(
      <ArchitectureDrillthroughPanel
        drillthrough={{
          operationsMapHref:
            "/platform/ai/operations-map?mode=compare&focus=data-policy-gateway",
          source: {
            path: "apps/web/lib/inference/data-screening/evaluate-inference-policy.ts",
            symbol: "evaluateInferenceDispatchPolicy",
            version: "ai-routing/v1",
            implementationStatus: "partial",
            href: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/inference/data-screening/evaluate-inference-policy.ts",
          },
          relatedViews: [
            {
              elementId: "req-1",
              elementName: "REQ-AIC-10 Screen before external egress",
              viewId: "sysml-view",
              viewName: "Requirements & Verification",
              notationSlug: "sysml2",
              notationName: "SysML 2",
              relationshipPath: ["Traces", "Satisfies"],
              distance: 2,
              href: "/ea/views/sysml-view?element=req-1",
            },
          ],
          decision: {
            title: "What did data policy decide?",
            technicalName: "Allow, protect, review, or deny gateway",
            safeInputs: ["Data classes", "Purpose"],
            outcomes: ["Allow", "Deny"],
            sourcePath: "apps/web/lib/inference/data-screening/evaluate-inference-policy.ts",
            sourceSymbol: "evaluateInferenceDispatchPolicy",
            sourceVersion: "ai-routing/v1",
            implementationStatus: "partial",
            latestEvidenceAt: "2026-07-27T02:00:00.000Z",
          },
        }}
      />,
    );

    expect(html).toContain("Open operational evidence");
    expect(html).toContain("Related viewpoints (1)");
    expect(html).toContain("REQ-AIC-10 Screen before external egress");
    expect(html).toContain("Safe inputs");
    expect(html).toContain("Possible outcomes");
    expect(html).toContain("latest record");
    expect(html).not.toContain("prompt");
  });
});
