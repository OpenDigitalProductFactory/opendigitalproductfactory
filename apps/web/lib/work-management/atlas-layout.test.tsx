// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { translate } from "@dpf/i18n";
import { ALL_ARCHETYPES, deriveTwinProfile, type TwinTemplate } from "@dpf/storefront-templates";

import { AtlasJustNow, AtlasLaneBoard } from "@/components/ops/workrooms/atlas/AtlasLaneBoard";
import { WorkAtlas } from "@/components/ops/workrooms/atlas/WorkAtlas";
import { ATLAS_LAYOUTS, atlasLayoutFor, placeAtlasRooms, readAtlasPlacement } from "./atlas-layout";
import { loadAtlasJustNow, loadAtlasLayout } from "./atlas-page.server";
import type { AtlasPicture, AtlasRoom } from "./atlas-projection";

const t = (key: string, args?: Record<string, unknown>) => translate("en-US", "workrooms", key as never, args as never);

const STATES = ["needs-person", "stuck", "no-signal", "working", "waiting", "finished"] as const;
function picture(rooms: AtlasRoom[]): AtlasPicture {
  const counts = Object.fromEntries(STATES.map((s) => [s, rooms.filter((r) => r.health === s).length])) as AtlasPicture["counts"];
  return { observedAt: "2026-11-13T00:00:00.000Z", total: rooms.length, truncated: false, counts, rooms };
}
const rooms: AtlasRoom[] = STATES.map((health, i) => ({
  capsuleId: `WC-0000000${i}`, title: `Room ${i}`, portfolio: "manufactureAndDeliver", health, label: "inventory.status.working",
}));

function glyphs(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll("[data-atlas-cell]")]
    .map((cell) => `${cell.getAttribute("data-atlas-cell")}|${cell.innerHTML}`).sort();
}

describe("Work Atlas business layouts (BI-B0D8394B)", () => {
  const tenants = glyphs(renderToStaticMarkup(
    <WorkAtlas picture={picture(rooms)} view={{}} basePath="/ops/workrooms" shapes={{}} holds={{}} locale="en-US" t={t} />,
  ));

  for (const template of Object.keys(ATLAS_LAYOUTS) as TwinTemplate[]) {
    if (template === "TENANTS") continue;
    it(`${template}: the glyphs are identical to the portfolio map's`, () => {
      const layout = atlasLayoutFor(template);
      const html = renderToStaticMarkup(<AtlasLaneBoard picture={picture(rooms)} layout={layout} workItems="jobs" view={{}} basePath="/ops/workrooms" t={t} />);
      expect(glyphs(html)).toEqual(tenants);
      // Unplaced rooms are shown, never dropped.
      expect(html).toContain("Not yet placed: 6 rooms");
    });
  }

  it("every archetype resolves to a layout from its own twin template", async () => {
    for (const archetype of ALL_ARCHETYPES) {
      const findFirst = vi.fn(async () => ({ archetype: { archetypeId: archetype.archetypeId } }));
      const layout = await loadAtlasLayout({ storefrontConfig: { findFirst } });
      const profile = deriveTwinProfile(archetype);
      expect(layout.template).toBe(profile.template);
      expect(layout.workItems).toBe(profile.workItemNoun.plural);
    }
  });

  it("an install with no archetype keeps the portfolio map", async () => {
    expect((await loadAtlasLayout({ storefrontConfig: { findFirst: async () => null } })).kind).toBe("portfolio");
    expect((await loadAtlasLayout({})).template).toBe("TENANTS");
  });

  it("places rooms by their recorded lane and slot, and never guesses", () => {
    const floor = atlasLayoutFor("FLOOR");
    const board = placeAtlasRooms(floor, [
      { id: "a", placement: { lane: "takeout", slot: "lunch" } },
      { id: "b", placement: { lane: "takeout" } },
      { id: "c", placement: { lane: "not-a-channel", slot: "lunch" } },
      { id: "d" },
    ]);
    expect(board.lanes.map((l) => l.key)).toEqual(["dine-in", "takeout", "delivery", "catering"]);
    expect(board.lanes[1]!.cells.lunch!.map((r) => r.id)).toEqual(["a"]);
    expect(board.lanes[1]!.unslotted.map((r) => r.id)).toEqual(["b"]);
    expect(board.unplaced.map((r) => r.id)).toEqual(["c", "d"]);

    const territory = placeAtlasRooms(atlasLayoutFor("TERRITORY"), [
      { id: "x", placement: { lane: "zone-north", laneLabel: "North", slot: "early" } },
    ]);
    expect(territory.lanes).toEqual([expect.objectContaining({ key: "zone-north", label: "North" })]);
  });

  it("reads a placement only from a well-formed outcome anchor", () => {
    expect(readAtlasPlacement({ atlasPlacement: { lane: "takeout", slot: "lunch" } })).toEqual({ lane: "takeout", slot: "lunch" });
    expect(readAtlasPlacement({ atlasPlacement: { lane: "<b>" } })).toBeNull();
    expect(readAtlasPlacement({})).toBeNull();
    expect(readAtlasPlacement(null)).toBeNull();
  });

  it("a lane layout asks the business's own question", () => {
    const html = renderToStaticMarkup(
      <WorkAtlas picture={picture(rooms)} view={{}} basePath="/ops/workrooms" shapes={{}} holds={{}} locale="en-US" t={t} layout={atlasLayoutFor("TERRITORY")} workItems="jobs" />,
    );
    expect(html).toContain("What has to be dispatched or rescued today?");
    expect(html).toContain('data-atlas-layout="TERRITORY"');
  });

  it("Just now lists the latest recorded room changes, newest first, linking each room", async () => {
    const findMany = vi.fn(async () => [
      { summary: "Moved to Implement", recordedAt: new Date("2026-11-13T03:10:00.000Z"), capsule: { capsuleId: "WC-AAAA0001", title: "Approval card recovery" } },
    ]);
    const rows = await loadAtlasJustNow({ workroomActivity: { findMany } });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { capsule: { archivedAt: null } }, take: 6 }));
    const html = renderToStaticMarkup(<AtlasJustNow rows={rows} view={{ state: "stuck" }} basePath="/ops/workrooms" locale="en-US" t={t} />);
    expect(html).toContain("Just now");
    expect(html).toContain("Approval card recovery");
    expect(html).toContain(": Moved to Implement");
    expect(html).toContain('href="/ops/workrooms?state=stuck&amp;room=WC-AAAA0001"');
    expect(renderToStaticMarkup(<AtlasJustNow rows={[]} view={{}} basePath="/ops/workrooms" locale="en-US" t={t} />)).toBe("");
  });
});
