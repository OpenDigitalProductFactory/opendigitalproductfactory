// Docker-gated end-to-end test of create_presentation (BI-543819B1, AC-ODC-009).
//
// Runs only when DPF_DOCTOOLS_TEST_IMAGE names a pinned dpf-doctools image
// (`name@sha256:…`, or the local image id `sha256:…` of a fresh
// `docker build -f Dockerfile.doctools`) AND docker answers. Otherwise every
// case is reported SKIPPED, never passed.
//
// The path under test is the real one: outline -> deck spec -> the engine in the
// organization's brand master -> saveRenderedDocument. Only the database is an
// in-memory stand-in, so the stored pptx, its PDF and the preview manifest are
// the bytes the portal would keep.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { isPinnedImageReference } from "@/lib/documents/conversion/command";
import { createConversionLimiter } from "@/lib/documents/conversion/convert";
import { parsePreviewManifest, PREVIEW_MANIFEST_MIME } from "@/lib/documents/preview-manifest";
import { ensureBrandMaster, type BrandSource } from "./brand-master";
import { createPresentation, type PresentationOutline } from "./create-presentation";
import { renderDocument, type RenderDeps } from "./render";
import { saveRenderedDocument, type RenderStoreDeps } from "./render-store";

vi.mock("@dpf/db", () => ({ prisma: {}, DocumentRenditionKind: { pdf: "pdf", plain_text: "plain_text", preview: "preview" } }));

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

const ORGANIZATION: BrandSource = {
  id: "org-e2e",
  name: "Second Chance Animal Rescue",
  designSystem: null,
  logoUrl: null,
  address: { line1: "1 Shelter Road", city: "Springfield", countryCode: "US" },
};

const OUTLINE: PresentationOutline = {
  title: "Spring adoption drive",
  subtitle: "Board update",
  audience: "Board",
  goal: "Approve the six-week plan and budget",
  slides: [
    { title: "Spring adoption drive" },
    { title: "Where we are", bullets: ["42 adoptions last quarter", "12 active foster homes"], notes: "Lead with fosters." },
    {
      title: "Adoptions by month",
      chart: { type: "column", categories: ["Jan", "Feb", "Mar"], series: [{ name: "Adoptions", values: [10, 14, 18] }] },
    },
    { title: "The plan", subtitle: "Six weeks, three channels" },
    { title: "Channels and budget", table: { columns: ["Channel", "Budget"], rows: [["Email", 0], ["Social", 150], ["Events", 300]] } },
    { title: "The ask", bullets: ["Approve the budget", "Name a volunteer lead"] },
  ],
};

/** An in-memory document store: blobs by id, versions per document. */
function memoryStore() {
  const blobs = new Map<string, { bytes: Buffer; mime: string }>();
  const versions = new Map<string, number>();
  const renditions: Array<{ versionId: string; kind: string; blobId: string | null; mimeType: string }> = [];
  let documents = 0;
  const deps: RenderStoreDeps = {
    storeBlob: async (bytes, mime) => {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      blobs.set(sha256, { bytes, mime });
      return { id: sha256, sha256 };
    },
    saveDocument: async (input) => {
      const documentId = input.documentId ?? `DOC-E2E${++documents}`;
      const version = (versions.get(documentId) ?? 0) + 1;
      versions.set(documentId, version);
      return { documentId, currentVersionId: `${documentId}-v${version}`, version };
    },
    upsertRendition: async (row) => {
      renditions.push({ versionId: row.versionId, kind: row.kind, blobId: row.blobId, mimeType: row.mimeType });
    },
  };
  return { deps, blobs, renditions };
}

const ready = dockerHasImage(IMAGE);
const renderDeps: RenderDeps = {
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
};

describe.skipIf(!ready)("create_presentation against the real dpf-doctools image", () => {
  it("turns a six-slide outline into a stored branded pptx, a pdf and six slide previews, then revises it as version 2", async () => {
    const store = memoryStore();
    const deps = {
      render: (request: Parameters<typeof renderDocument>[0]) => renderDocument(request, renderDeps),
      save: (rendered: Parameters<typeof saveRenderedDocument>[0], target: Parameters<typeof saveRenderedDocument>[1]) =>
        saveRenderedDocument(rendered, target, store.deps),
      resolveOrganizationId: async () => ORGANIZATION.id,
      loadDocument: async (documentId: string) =>
        documentId === "DOC-E2E1" ? { documentKind: "generated-deck", organizationId: ORGANIZATION.id } : null,
      loadImage: async () => null,
    };

    const created = await createPresentation({ outline: OUTLINE }, deps);
    if (!created.ok) throw new Error(`${created.reason}: ${created.error}`);
    expect(created.data).toMatchObject({ documentId: "DOC-E2E1", version: 1, slideCount: 6, previewCount: 6, formats: ["pptx", "pdf"] });

    const stored = [...store.blobs.values()];
    const pptx = stored.find((blob) => blob.mime.includes("presentationml"));
    expect(pptx?.bytes.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(stored.find((blob) => blob.mime === "application/pdf")?.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const preview = store.renditions.find((row) => row.versionId === "DOC-E2E1-v1" && row.kind === "preview");
    expect(preview?.mimeType).toBe(PREVIEW_MANIFEST_MIME);
    const manifest = parsePreviewManifest(store.blobs.get(preview!.blobId!)!.bytes);
    expect(manifest?.pages.map((page) => page.page)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const page of manifest!.pages) {
      expect(store.blobs.get(page.blobId)?.bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
    }

    const revisedOutline = { ...OUTLINE, documentId: "DOC-E2E1" };
    revisedOutline.slides = OUTLINE.slides.map((slide, index) =>
      index === 5 ? { title: "The ask", bullets: ["Approve $450 over six weeks", "Name a volunteer lead by Friday"] } : slide,
    );
    const revised = await createPresentation({ outline: revisedOutline }, deps);
    if (!revised.ok) throw new Error(`${revised.reason}: ${revised.error}`);
    expect(revised.data).toMatchObject({ documentId: "DOC-E2E1", version: 2, revised: true, previewCount: 6 });
  }, 480_000);
});
