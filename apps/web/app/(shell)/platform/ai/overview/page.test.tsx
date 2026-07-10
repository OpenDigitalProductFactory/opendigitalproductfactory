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
    expect(html).toContain("HR &amp; People Ops");
    expect(html).toContain("/platform/ai/agent/hr-specialist");
  });
});
