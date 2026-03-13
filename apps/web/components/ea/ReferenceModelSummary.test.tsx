import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReferenceModelSummary } from "./ReferenceModelSummary";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("ReferenceModelSummary", () => {
  it("renders model cards with portfolio counts", () => {
    const html = renderToStaticMarkup(
      <ReferenceModelSummary
        models={[
          {
            id: "rm-1",
            slug: "it4it_v3_0_1",
            name: "IT4IT",
            version: "3.0.1",
            status: "active",
            criteriaCount: 417,
            assessmentCount: 12,
            proposalCount: 1,
          },
        ]}
      />
    );

    expect(html).toContain("IT4IT");
    expect(html).toContain("3.0.1");
    expect(html).toContain("417 criteria");
    expect(html).toContain("/ea/models/it4it_v3_0_1");
  });
});
