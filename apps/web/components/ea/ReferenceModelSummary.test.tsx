import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ReferenceModelSummary } from "@/components/ea/ReferenceModelSummary";
import type { ReferenceModelSummary as Row } from "@/lib/explore/reference-model-types";

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "m1",
    slug: "it4it_v3_0_1",
    name: "IT4IT",
    version: "3.0.1",
    status: "active",
    applies: true,
    applicabilityReason: "Applies to every install.",
    criteriaCount: 688,
    assessmentCount: 452,
    proposalCount: 0,
    ...overrides,
  };
}

const bian = row({
  id: "m2",
  slug: "bian_service_landscape_v14_0_0",
  name: "BIAN Service Landscape",
  version: "14.0.0",
  status: "active",
  applies: false,
  applicabilityReason: "Serves banking-financial-services, and this install is pet-rescue.",
  criteriaCount: 0,
  assessmentCount: 0,
  proposalCount: 0,
});

describe("ReferenceModelSummary", () => {
  // The defect this fixes, exactly as the founder saw it on 2026-09-07: a pet
  // rescue's EA page offering "BIAN Service Landscape — ACTIVE — 0 criteria".
  // Zero counts are CORRECT there; presenting them under a live status is not.
  it("never shows an inapplicable model as active with zero counts", () => {
    const html = renderToStaticMarkup(<ReferenceModelSummary models={[bian]} />);

    expect(html).toContain("BIAN Service Landscape");
    expect(html).toContain("not this archetype");
    expect(html).not.toContain("0 criteria");
    expect(html).not.toContain("0 assessments");
  });

  it("says why the model is not this install's business", () => {
    const html = renderToStaticMarkup(<ReferenceModelSummary models={[bian]} />);
    expect(html).toContain("Serves banking-financial-services");
    expect(html).toContain("pet-rescue");
  });

  it("keeps the counts and the lifecycle status for a model that does apply", () => {
    const html = renderToStaticMarkup(<ReferenceModelSummary models={[row()]} />);

    expect(html).toContain("688 criteria");
    expect(html).toContain("452 assessments");
    expect(html).toContain("active");
    expect(html).not.toContain("not this archetype");
  });

  // The catalogue entry is kept on every install on purpose, so an operator can
  // see the standard exists. Dropping it would undo that deliberately.
  it("still lists the inapplicable model rather than hiding it", () => {
    const html = renderToStaticMarkup(<ReferenceModelSummary models={[row(), bian]} />);

    expect(html).toContain("IT4IT");
    expect(html).toContain("BIAN Service Landscape");
    expect(html).toContain('href="/ea/models/bian_service_landscape_v14_0_0"');
    expect(html).toContain('data-applies="false"');
    expect(html).toContain('data-applies="true"');
  });

  it("renders the empty state when no models are registered", () => {
    const html = renderToStaticMarkup(<ReferenceModelSummary models={[]} />);
    expect(html).toContain("No reference models have been registered yet.");
  });
});
