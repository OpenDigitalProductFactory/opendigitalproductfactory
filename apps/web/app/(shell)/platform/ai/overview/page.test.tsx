import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RosterRow, RosterFacets } from "@/lib/coworker-record/roster";

vi.mock("@/lib/coworker-record/roster", () => ({
  loadRoster: vi.fn(),
}));

vi.mock("@/lib/coworker-record/corpus-signals", () => ({
  loadProfessionCorpusSignals: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/components/platform/coworker-record/ProfessionCorpusPanel", () => ({
  ProfessionCorpusPanel: () => <section>profession-corpus-panel</section>,
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: any }) => <a href={href}>{children}</a>,
}));

import { loadRoster } from "@/lib/coworker-record/roster";

function row(over: Partial<RosterRow> = {}): RosterRow {
  return {
    agentId: "hr-specialist",
    slugId: "hr-specialist",
    name: "HR Specialist",
    displayName: "HR Specialist",
    kind: "specialist",
    tier: 2,
    valueStream: "operate",
    lifecycleStage: "production",
    plainJob: "Supports the employee lifecycle.",
    area: { key: "for_employees", label: "Your team", order: 2 },
    areas: [{ key: "for_employees", label: "Your team", order: 2 }],
    interaction: { scopes: ["internal-only"], labels: ["Internal only"] },
    availability: {
      state: "available",
      label: "Available for your business type",
      reason: "Explicit support",
      matchLevel: "leaf",
      evidence: [],
    },
    authority: {
      state: "resolved",
      scope: { kind: "default-posture" },
      level: "review-required",
      label: "Acts with review",
      summary: "This coworker acts within limits and a person reviews results.",
      ownerReason: "Review is required.",
      ownerAction: "Review the result after the action runs.",
      winner: {
        source: "agent",
        ref: "hr-specialist",
        field: "hitlTierDefault",
        role: "selected-base",
        observedValue: "2",
        normalizedLevel: "review-required",
        detail: "Agent has HITL tier 2",
      },
      evidence: [],
    },
    familyKey: "hr-people-ops",
    familyLabel: "HR & People Ops",
    coveragePct: 60,
    jurisdictions: ["global"],
    competencies: ["practitioner"],
    profileBound: true,
    emptyCorpus: false,
    providerHealthy: true,
    openBlockers: 0,
    deferRate: 0,
    unmapped: false,
    lastActiveAt: null,
    ...over,
  };
}

const facets: RosterFacets = {
  families: [{ key: "hr-people-ops", label: "HR & People Ops" }],
  valueStreams: ["operate"],
  jurisdictions: ["global"],
  competencies: ["practitioner"],
  lifecycleStages: ["production"],
};

describe("PlatformAiOverviewPage", () => {
  it("preserves the coworker directory as a drilldown", async () => {
    vi.mocked(loadRoster).mockResolvedValue({ rows: [row()], facets });

    const { default: PlatformAiOverviewPage } = await import("./page");
    const html = renderToStaticMarkup(await PlatformAiOverviewPage());

    expect(html).toContain("HR Specialist");
    expect(html).toContain("Your team");
    expect(html).toContain("Supports the employee lifecycle.");
    expect(html).toContain("Acts with review");
    expect(html).toContain("/platform/ai/agent/hr-specialist");
  });

  it("describes an empty selectable roster honestly and offers a recovery path", async () => {
    vi.mocked(loadRoster).mockResolvedValue({ rows: [], facets });

    const { default: PlatformAiOverviewPage } = await import("./page");
    const html = renderToStaticMarkup(await PlatformAiOverviewPage());

    expect(html).toContain("No selectable coworkers");
    expect(html).toContain("inactive, not in production, or missing matching identity records");
    expect(html).toContain('href="/platform/ai/readiness"');
    expect(html).not.toContain("No coworkers registered yet");
  });
});
