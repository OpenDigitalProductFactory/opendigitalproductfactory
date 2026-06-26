import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RosterRow, RosterFacets } from "@/lib/coworker-record/roster";

// The roster page is now a workforce directory (HRIS surface §7): it delegates
// data assembly to loadRoster and renders RosterView. Mock the aggregator and
// assert the directory rendering + record links (the aggregator + filter
// predicates have their own unit tests).
vi.mock("@/lib/coworker-record/roster", () => ({
  loadRoster: vi.fn(),
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

describe("PlatformAiPage (workforce directory)", () => {
  it("renders coworker rows linking to their records", async () => {
    vi.mocked(loadRoster).mockResolvedValue({ rows: [row()], facets });

    const { default: PlatformAiPage } = await import("./page");
    const html = renderToStaticMarkup(await PlatformAiPage());

    expect(html).toContain("HR Specialist");
    expect(html).toContain("HR &amp; People Ops");
    expect(html).toContain("/platform/ai/agent/hr-specialist");
  });

  it("surfaces a coverage-gap banner for unmapped or empty-corpus coworkers", async () => {
    vi.mocked(loadRoster).mockResolvedValue({
      rows: [row({ unmapped: true, familyKey: null, familyLabel: null, coveragePct: null })],
      facets,
    });

    const { default: PlatformAiPage } = await import("./page");
    const html = renderToStaticMarkup(await PlatformAiPage());

    expect(html).toContain("profession-coverage gap");
  });
});
