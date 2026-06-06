import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, getPipelineInspectorView } = vi.hoisted(() => ({
  findMany: vi.fn(),
  getPipelineInspectorView: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    opportunity: {
      findMany,
    },
  },
}));

vi.mock("@/lib/actions/crm", () => ({
  updateOpportunityStageFromForm: vi.fn(),
}));

vi.mock("@/lib/crm/pipeline-inspector-data", () => ({
  getPipelineInspectorView,
}));

import OpportunitiesPage from "./page";

describe("OpportunitiesPage", () => {
  beforeEach(() => {
    findMany.mockResolvedValue([]);
    getPipelineInspectorView.mockResolvedValue(null);
  });

  it("offers guided coworker work from the empty pipeline state", async () => {
    const html = renderToStaticMarkup(
      await OpportunitiesPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("No opportunities yet");
    expect(html).toContain("Start guided pipeline work");
    expect(html).toContain("Find qualified pipeline");
    expect(html).toContain('data-topic-id="qualify-engagements"');
    expect(html).toContain("var(--dpf-");
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  });
});
