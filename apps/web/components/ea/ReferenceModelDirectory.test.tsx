import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { ReferenceModelDirectory } from "@/components/ea/ReferenceModelDirectory";

describe("ReferenceModelDirectory", () => {
  it("renders a browseable list of reference models", () => {
    const html = renderToStaticMarkup(
      <ReferenceModelDirectory
        models={[
          {
            id: "rm-1",
            slug: "it4it_v3_0_1",
            name: "IT4IT",
            version: "3.0.1",
            status: "active",
            applies: true,
            applicabilityReason: "Applies to every install.",
            criteriaCount: 417,
            assessmentCount: 12,
            proposalCount: 1,
          },
        ]}
      />,
    );

    expect(html).toContain("Reference Models");
    expect(html).toContain("IT4IT");
    expect(html).toContain("417 criteria");
    expect(html).toContain('href="/ea/models/it4it_v3_0_1"');
  });

  // BI-C44EAEE6: /ea/models had the same defect as the EA overview.
  it("shows an industry model that is not this install's as such, not as active", () => {
    const html = renderToStaticMarkup(
      <ReferenceModelDirectory
        models={[
          {
            id: "rm-2",
            slug: "bian_service_landscape_v14_0_0",
            name: "BIAN Service Landscape",
            version: "14.0.0",
            status: "active",
            applies: false,
            applicabilityReason:
              "Serves banking-financial-services, and this install is pet-rescue.",
            criteriaCount: 0,
            assessmentCount: 0,
            proposalCount: 0,
          },
        ]}
      />,
    );

    expect(html).toContain("BIAN Service Landscape");
    expect(html).toContain("not this archetype");
    expect(html).toContain("Serves banking-financial-services");
    expect(html).not.toContain("0 criteria");
    expect(html).not.toContain("0 assessments");
  });
});
