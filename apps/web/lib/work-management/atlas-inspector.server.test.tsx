// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { translate } from "@dpf/i18n";

import { AtlasInspector } from "@/components/ops/workrooms/atlas/AtlasInspector";
import { loadAtlasInspector, type AtlasInspectorDb } from "./atlas-inspector.server";
import type { AtlasRoom } from "./atlas-projection";
import { loadWorkroomFlowMap } from "./workroom-flow-map.server";

const now = new Date("2026-11-12T12:00:00.000Z");
const t = (key: string, args?: Record<string, unknown>) => translate("en-US", "workrooms", key as never, args as never);

function db(overrides: Partial<{ drive: Record<string, unknown> | null; activity: { summary: string; recordedAt: Date } | null; found: boolean }> = {}) {
  const drive = overrides.drive === undefined ? { action: "pause", reason: "conformance_pause", stageKey: "repair" } : overrides.drive;
  const room = { capsuleId: "WC-1A2B3C4D", scopeClaims: [{ workShape: "delivery-small@1.0.0" }], workspaceState: drive ? { workroomDrive: drive } : {} };
  return {
    workroom: {
      findFirst: vi.fn(async () => (overrides.found === false ? null : { id: "row-1" })),
      findUnique: vi.fn(async () => room),
    },
    workroomActivity: { findFirst: vi.fn(async () => (overrides.activity === undefined ? { summary: "Repair started", recordedAt: now } : overrides.activity)) },
    queueTelemetryEvent: { findMany: vi.fn(async () => []) },
    queueMetricSnapshot: { findMany: vi.fn(async () => []) },
  } as unknown as AtlasInspectorDb;
}

const atlasRoom: AtlasRoom = {
  capsuleId: "WC-1A2B3C4D", title: "Invoice matching tolerance", portfolio: "manufactureAndDeliver",
  health: "stuck", label: "inventory.status.attention", owner: "Release reviewer", shape: "delivery-small", stage: "repair",
};

describe("Work Atlas inspector (BI-94C9AFC1)", () => {
  it("shows the same stages and current step as the room page, because it reads the same flow map", async () => {
    const source = db();
    const roomPage = await loadWorkroomFlowMap(source, { roomRowId: "row-1", now });
    const data = await loadAtlasInspector(source, "WC-1A2B3C4D", now);
    expect(data?.flow).toEqual(roomPage);

    const document = new DOMParser().parseFromString(renderToStaticMarkup(
      <AtlasInspector room={atlasRoom} data={data!} hold={undefined} roomHref="/workspace/cases/x" flowHref={null} closeHref="/ops/workrooms" locale="en-US" t={t} />,
    ), "text/html");
    const rendered = [...document.querySelectorAll("[data-inspector-stage]")].map((node) => [node.getAttribute("data-inspector-stage"), node.getAttribute("data-stage-state")]);
    expect(rendered).toEqual(roomPage!.stages.map((stage) => [stage.key, stage.state]));
    expect(document.querySelector('[aria-current="step"]')?.getAttribute("data-inspector-stage")).toBe("repair");
  });

  it("the room detail page loads its checklist through the same loader", () => {
    const detail = readFileSync(join(__dirname, "workspace-case-detail.server.ts"), "utf8");
    expect(detail).toContain("loadWorkroomFlowMap");
  });

  it("names the recorded cause and recovery for a held room, and links to the room", async () => {
    const data = await loadAtlasInspector(db(), "WC-1A2B3C4D", now);
    const html = renderToStaticMarkup(
      <AtlasInspector room={atlasRoom} data={data!} hold={{ reason: "conformance pause", since: null, recovery: "a coordinator is named" }}
        roomHref="/workspace/cases/work-capsule%3AWC-1A2B3C4D" flowHref="/area/delivery?view=work&shape=delivery-small" closeHref="/ops/workrooms" locale="en-US" t={t} />,
    );
    expect(html).toContain("Held: conformance pause.");
    expect(html).toContain("Recovery condition: a coordinator is named");
    expect(html).toContain("Latest: Repair started");
    expect(html).toContain('href="/workspace/cases/work-capsule%3AWC-1A2B3C4D"');
    expect(html).toContain("Show in flow map");
  });

  it("names who must act for a room waiting on a person", async () => {
    const data = await loadAtlasInspector(db({ drive: null, activity: null }), "WC-1A2B3C4D", now);
    const html = renderToStaticMarkup(
      <AtlasInspector room={{ ...atlasRoom, health: "needs-person", label: "inventory.status.closeout" }} data={data!} hold={undefined}
        roomHref="/x" flowHref={null} closeHref="/ops/workrooms" locale="en-US" t={t} />,
    );
    expect(html).toContain("Needs Release reviewer: Ready for closeout.");
    expect(html).toContain("Nothing recorded in this room yet.");
  });

  it("opens no panel for a room that is not open", async () => {
    expect(await loadAtlasInspector(db({ found: false }), "WC-GONE0000", now)).toBeNull();
  });
});
