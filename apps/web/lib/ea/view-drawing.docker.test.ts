// Docker-gated end-to-end test of EA view drawing export (BI-4C17BF51, AC-ODC-010
// export half): a 24-element EA view goes view -> drawing spec -> the real
// dpf-render engine -> .odg / .svg / .pdf / .png.
//
// Runs only when DPF_DOCTOOLS_TEST_IMAGE names a pinned dpf-doctools image
// (`name@sha256:…`, or the local image id `sha256:…` of a fresh
// `docker build -f Dockerfile.doctools`) AND docker answers. Otherwise every
// case is reported SKIPPED, never passed.

import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { isPinnedImageReference } from "@/lib/documents/conversion/command";
import { createConversionLimiter } from "@/lib/documents/conversion/convert";
import { renderDocument, type RenderDocumentRequest } from "@/lib/documents/generation/render";
import { exportEaViewDrawingFile, DEFAULT_DRAWING_TOKENS } from "./view-drawing-export";
import type { EaViewForDrawing } from "./view-drawing";
import { readZipEntry } from "./zip.test-support";

vi.mock("@dpf/db", () => ({ prisma: {} }));

const IMAGE = process.env.DPF_DOCTOOLS_TEST_IMAGE?.trim() ?? "";

function dockerHasImage(image: string): boolean {
  if (!isPinnedImageReference(image)) return false;
  try {
    // ambient-host-guard: allow the docker gate itself; a host without the image reports this suite SKIPPED
    return spawnSync("docker", ["image", "inspect", image], { stdio: "ignore", timeout: 15_000 }).status === 0;
  } catch {
    return false;
  }
}

const LAYERS = ["ArchiMate__BusinessProcess", "ArchiMate__ApplicationComponent", "ArchiMate__Node"];

/** A 24-element, three-layer view with 23 relationships and a saved layout. */
function orderPlatformView(): EaViewForDrawing {
  const elements = Array.from({ length: 24 }, (_, index) => ({
    viewElementId: `ve-${String(index).padStart(2, "0")}`,
    parentViewElementId: null,
    orderIndex: null,
    rendererHint: null,
    mode: "new" as const,
    proposedProperties: null,
    elementType: { slug: `type-${index % 3}`, name: LAYERS[index % 3]!.slice(11), neoLabel: LAYERS[index % 3]! },
    element: { name: `Order element ${String(index).padStart(2, "0")}` },
  }));
  const nodes = Object.fromEntries(elements.map((element, index) => [element.viewElementId, { x: (index % 6) * 240, y: Math.floor(index / 6) * 150 }]));
  const edges = elements.slice(1).map((element, index) => ({
    id: `rel-${index}`,
    fromViewElementId: elements[index]!.viewElementId,
    toViewElementId: element.viewElementId,
    relationshipType: { slug: "serves", name: "serves" },
  }));
  return { name: "Order platform", elements, edges, canvasState: { viewport: { x: 0, y: 0, zoom: 1 }, nodes } };
}

const ready = dockerHasImage(IMAGE);
const deps = {
  loadView: async () => orderPlatformView(),
  loadTokens: async () => DEFAULT_DRAWING_TOKENS,
  render: (request: RenderDocumentRequest) =>
    renderDocument(request, { resolveImage: async () => ({ status: "pinned", image: IMAGE }), limiter: createConversionLimiter(2) }),
};

describe.skipIf(!ready)("EA view drawing export against the real dpf-doctools image", () => {
  it("exports a 24-element view to an .odg that Draw reads as 24 shapes joined by 23 glued connectors", async () => {
    const out = await exportEaViewDrawingFile({ viewId: "view-1", format: "odg" }, deps);
    if (!out.ok) throw new Error(out.error);
    expect(out.data.fileName).toBe("Order platform.odg");
    expect(out.data.mimeType).toBe("application/vnd.oasis.opendocument.graphics");
    const content = readZipEntry(out.data.bytes, "content.xml")?.toString("utf8") ?? "";
    expect(content.match(/<draw:custom-shape\b/g)).toHaveLength(24);
    const connectors = content.match(/<draw:connector\b[^>]*>/g) ?? [];
    expect(connectors).toHaveLength(23);
    for (const connector of connectors) {
      expect(connector).toMatch(/draw:start-shape="[^"]+"/);
      expect(connector).toMatch(/draw:end-shape="[^"]+"/);
    }
    expect(content).toContain("Order element 00");
    expect(content).toContain("Order element 23");
  }, 240_000);

  it.each(["svg", "pdf"] as const)("exports the view to .%s with every element label", async (format) => {
    const out = await exportEaViewDrawingFile({ viewId: "view-1", format }, deps);
    if (!out.ok) throw new Error(out.error);
    if (format === "pdf") {
      expect(out.data.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    } else {
      const svg = out.data.bytes.toString("utf8");
      expect(svg).toContain("<svg");
      for (const index of [0, 11, 23]) expect(svg).toContain(`Order element ${String(index).padStart(2, "0")}`);
    }
  }, 240_000);

  it("exports the view to a .png picture", async () => {
    const out = await exportEaViewDrawingFile({ viewId: "view-1", format: "png" }, deps);
    if (!out.ok) throw new Error(out.error);
    expect(out.data.bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
    // 150 dpi of a page at least A4 landscape wide: comfortably over 1000 px.
    expect(out.data.bytes.readUInt32BE(16)).toBeGreaterThan(1000);
  }, 240_000);
});
