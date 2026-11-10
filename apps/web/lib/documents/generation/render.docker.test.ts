// Docker-gated end-to-end test of template-driven generation (BI-3A0E5413,
// AC-ODC-009 engine half).
//
// Runs only when DPF_DOCTOOLS_TEST_IMAGE names a pinned dpf-doctools image
// (`name@sha256:…`, or the local image id `sha256:…` of a fresh
// `docker build -f Dockerfile.doctools`) AND docker answers. Otherwise every
// case is reported SKIPPED, never passed.
//
// The specs are the committed smoke fixtures (tools/doctools/fixtures/render-*.json);
// the brand master is built from an in-memory Organization, so no database is needed.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isPinnedImageReference } from "@/lib/documents/conversion/command";
import { createConversionLimiter } from "@/lib/documents/conversion/convert";
import { ensureBrandMaster, type BrandSource } from "./brand-master";
import { renderDocument, type RenderDeps, type RenderDocumentRequest } from "./render";

vi.mock("@dpf/db", () => ({ prisma: {} }));

const IMAGE = process.env.DPF_DOCTOOLS_TEST_IMAGE?.trim() ?? "";
const FIXTURES = resolve(__dirname, "../../../../../tools/doctools/fixtures");

function dockerHasImage(image: string): boolean {
  if (!isPinnedImageReference(image)) return false;
  try {
    // ambient-host-guard: allow the docker gate itself; a host without the image reports this suite SKIPPED
    return spawnSync("docker", ["image", "inspect", image], { stdio: "ignore", timeout: 15_000 }).status === 0;
  } catch {
    return false;
  }
}

function fixture(family: string): RenderDocumentRequest {
  const { content, formats } = JSON.parse(readFileSync(resolve(FIXTURES, `render-${family}.json`), "utf8"));
  return { content, formats };
}

const ORGANIZATION: BrandSource = {
  id: "org-e2e",
  name: "Second Chance Animal Rescue",
  designSystem: null,
  logoUrl: null,
  address: { line1: "1 Shelter Road", city: "Springfield", countryCode: "US" },
};

const ready = dockerHasImage(IMAGE);
const deps = (overrides: Partial<RenderDeps> = {}): RenderDeps => ({
  resolveImage: async () => ({ status: "pinned", image: IMAGE }),
  limiter: createConversionLimiter(2),
  now: () => new Date("2026-09-25T12:00:00Z"),
  resolveTemplate: async (_ref, family) =>
    ensureBrandMaster(
      { organizationId: ORGANIZATION.id, family },
      {
        loadOrganization: async () => ORGANIZATION,
        loadLogo: async () => null,
        loadCurrentVersion: async () => null,
        storeVersion: async () => ({ version: 1 }),
      },
    ),
  ...overrides,
});

describe.skipIf(!ready)("renderDocument against the real dpf-doctools image", () => {
  it("renders a branded deck (title, five content slides, a chart, an image) to pptx, pdf and slide previews", async () => {
    const out = await renderDocument(
      { ...fixture("deck"), templateRef: { kind: "brand-master", organizationId: ORGANIZATION.id } },
      deps(),
    );
    if (!out.ok) throw new Error(`${out.reason}: ${out.error}`);
    const [pptx, pdf] = out.data.files;
    expect(pptx.format).toBe("pptx");
    expect(pptx.bytes.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(pdf.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(out.data.pageCount).toBe(6);
    expect(out.data.previews).toHaveLength(6);
    for (const png of out.data.previews) expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    // The brand master's footer carries the organization's name onto every slide.
    expect(out.data.text).toContain("Second Chance Animal Rescue");
    expect(out.data.text).toContain("Adoptions by month");
  }, 240_000);

  it("renders the same spec identically twice: same text layer, same slide count", async () => {
    const first = await renderDocument(fixture("deck"), deps());
    const second = await renderDocument(fixture("deck"), deps());
    if (!first.ok || !second.ok) throw new Error("a render failed");
    expect(second.data.text).toBe(first.data.text);
    expect(second.data.pageCount).toBe(first.data.pageCount);
  }, 240_000);

  it.each(["report", "letter", "sheet", "drawing"])("renders a branded %s in every requested format", async (family) => {
    const request = fixture(family);
    const out = await renderDocument({ ...request, templateRef: { kind: "brand-master", organizationId: ORGANIZATION.id } }, deps());
    if (!out.ok) throw new Error(`${out.reason}: ${out.error}`);
    expect(out.data.files.map((file) => file.format)).toEqual(request.formats);
    expect(out.data.previews.length).toBeGreaterThan(0);
    expect(out.data.text).toMatch(/DPFRENDER/);
  }, 240_000);

  it("rejects an invalid spec before any container runs", async () => {
    const run = vi.fn();
    const out = await renderDocument({ ...fixture("deck"), formats: ["xlsx"] }, deps({ run }));
    expect(out).toMatchObject({ ok: false, reason: "invalid-spec" });
    expect(run).not.toHaveBeenCalled();
  });
});
