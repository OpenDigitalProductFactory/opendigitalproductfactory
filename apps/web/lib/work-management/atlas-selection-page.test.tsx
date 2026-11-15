// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@dpf/i18n";

const { picture } = vi.hoisted(() => ({ picture: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/work-management/atlas-projection.server", () => ({ loadAtlasPicture: picture }));
vi.mock("@/lib/work-management/atlas-inspector.server", () => ({ loadAtlasInspector: async () => ({ flow: null, live: null }) }));
vi.mock("@/lib/work-management/held-workrooms", () => ({ loadHeldWorkrooms: async () => [] }));
vi.mock("@/lib/work-management/standing-run-history.server", () => ({ loadStandingRhythms: async () => [] }));
vi.mock("@/lib/work-management/atlas-page.server", () => ({ atlasHolds: () => ({}), atlasShapeMeta: () => ({}), atlasFlowHref: () => null }));
vi.mock("@/lib/i18n/locale-context.server", () => ({ getLocaleContext: async () => ({ language: "en-US" }) }));
vi.mock("@/lib/i18n/t.server", () => ({ getT: async () => (key: string, args?: Record<string, unknown>) => translate("en-US", "workrooms", key as never, args as never) }));
vi.mock("@/components/ops/OpsTabNav", () => ({ OpsTabNav: () => null }));
vi.mock("@/components/ops/workrooms/atlas/RhythmStrip", () => ({ RhythmStrip: () => null }));
vi.mock("@/components/ops/workrooms/atlas/WorkAtlas", () => ({ WorkAtlas: ({ inspector }: { inspector: React.ReactNode }) => inspector, roomHref: (id: string) => `/workspace/cases/${id}` }));
const { default: WorkroomsPage } = await import("@/app/(shell)/ops/workrooms/page");

beforeEach(() => {
  picture.mockReset().mockImplementation(async (_db, options) => ({
    rooms: [{ capsuleId: "WC-1A2B3C4D", title: "Synthetic room", portfolio: "unplaced", health: "needs-person", label: "inventory.status.attention", owner: "Synthetic accountable person",
      ...(options?.selectedCapsuleId === "WC-1A2B3C4D" ? { nextAction: "inventory.nextAction.decision", action: { actor: "inventory.actor.decisionOwner", instruction: "inventory.action.decision", decisionRecorded: true, detail: "Synthetic recorded question" } } : {}) }],
  }));
});

describe("Workrooms URL selection reaches its existing inspector", () => {
  it("renders the selected recorded decision instead of the accountable person's generic status", async () => {
    const html = renderToStaticMarkup(await WorkroomsPage({ searchParams: Promise.resolve({ room: "WC-1A2B3C4D" }) }));
    expect(html).toContain("Decision owner");
    expect(html).toContain("Synthetic recorded question");
    expect(html).not.toContain("Needs Synthetic accountable person:");
  });

  it.each([{}, { room: "WC-DEADBEEF" }])("opens no inspector for absent or unread selection %j", async params => {
    const html = renderToStaticMarkup(await WorkroomsPage({ searchParams: Promise.resolve(params) }));
    expect(html).not.toContain("data-atlas-inspector");
    expect(html).not.toContain("Synthetic recorded question");
  });
});
