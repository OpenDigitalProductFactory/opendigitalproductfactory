// Docker-gated end-to-end test of the render-family tools (BI-012487AA, AC-3):
// one example each of create_report, create_letter, create_sheet and
// create_drawing on the real engine.
//
// Runs only when DPF_DOCTOOLS_TEST_IMAGE names a pinned dpf-doctools image
// (`name@sha256:…`, or the local image id `sha256:…` of a fresh
// `docker build -f Dockerfile.doctools`) AND docker answers. Otherwise every
// case is reported SKIPPED, never passed.
//
// The path under test is the real one: outline -> family spec -> the engine in
// the organization's brand master -> saveRenderedDocument. Only the database is
// an in-memory stand-in, so the stored office file, its PDF and the preview
// manifest are the bytes the portal would keep.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { isPinnedImageReference } from "@/lib/documents/conversion/command";
import { createConversionLimiter } from "@/lib/documents/conversion/convert";
import { parsePreviewManifest, PREVIEW_MANIFEST_MIME } from "@/lib/documents/preview-manifest";
import { ensureBrandMaster, type BrandSource } from "./brand-master";
import { createDrawing, createLetter, createReport, createSheet } from "./create-family-documents";
import type { FamilyDocumentDeps, FamilyDocumentResult } from "./family-document";
import { RENDER_FORMAT_MIME, renderDocument, type RenderDeps } from "./render";
import { saveRenderedDocument, type RenderStoreDeps } from "./render-store";
import type { RenderFormat } from "./spec";

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

/** An in-memory document store: blobs by id, versions per document, documents by kind. */
function memoryStore() {
  const blobs = new Map<string, { bytes: Buffer; mime: string }>();
  const versions = new Map<string, number>();
  const kinds = new Map<string, string>();
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
      kinds.set(documentId, input.documentKind);
      return { documentId, currentVersionId: `${documentId}-v${version}`, version };
    },
    upsertRendition: async (row) => {
      renditions.push({ versionId: row.versionId, kind: row.kind, blobId: row.blobId, mimeType: row.mimeType });
    },
  };
  return { deps, blobs, kinds, renditions };
}

const ready = dockerHasImage(IMAGE);
const renderDeps: RenderDeps = {
  resolveImage: async () => ({ status: "pinned", image: IMAGE }),
  limiter: createConversionLimiter(2),
  now: () => new Date("2026-10-14T12:00:00Z"),
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

function pipeline(store: ReturnType<typeof memoryStore>): FamilyDocumentDeps {
  return {
    render: (request) => renderDocument(request, renderDeps),
    save: (rendered, target) => saveRenderedDocument(rendered, target, store.deps),
    resolveOrganizationId: async () => ORGANIZATION.id,
    loadDocument: async (documentId) => {
      const kind = store.kinds.get(documentId);
      return kind ? { documentKind: kind, organizationId: ORGANIZATION.id } : null;
    },
    loadImage: async () => null,
    now: () => new Date("2026-10-14T12:00:00Z"),
  };
}

const MAGIC: Record<string, (bytes: Buffer) => boolean> = {
  docx: (b) => b.subarray(0, 2).toString("latin1") === "PK",
  xlsx: (b) => b.subarray(0, 2).toString("latin1") === "PK",
  odg: (b) => b.subarray(0, 2).toString("latin1") === "PK",
  svg: (b) => b.toString("utf8", 0, 512).includes("<svg"),
  pdf: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-",
};

const EXAMPLES: Array<{
  family: string;
  formats: string[];
  run: (deps: FamilyDocumentDeps, documentId?: string) => Promise<FamilyDocumentResult>;
}> = [
  {
    family: "report",
    formats: ["docx", "pdf"],
    run: (deps, documentId) =>
      createReport(
        {
          outline: {
            title: "Third quarter operations",
            summary: "Adoptions rose a fifth; costs held flat.",
            documentId,
            sections: [
              { heading: "Adoptions", paragraphs: ["We placed 42 animals this quarter."], bullets: ["Dogs 30", "Cats 12"] },
              {
                heading: "By month",
                chart: { type: "column", categories: ["Jul", "Aug", "Sep"], series: [{ name: "Adoptions", values: [12, 14, 16] }] },
                table: { columns: ["Month", "Adoptions"], rows: [["Jul", 12], ["Aug", 14], ["Sep", 16]] },
              },
            ],
          },
        },
        deps,
      ),
  },
  {
    family: "letter",
    formats: ["docx", "pdf"],
    run: (deps, documentId) =>
      createLetter(
        {
          outline: {
            subject: "Thank you for your gift",
            recipient: { name: "Ada Lovelace", lines: ["12 Analytical Way", "London"] },
            paragraphs: ["Thank you for your generous gift.", "It paid for a month of vet care."],
            signatureName: "Grace Hopper",
            signatureTitle: "Director",
            documentId,
          },
        },
        deps,
      ),
  },
  {
    family: "sheet",
    formats: ["xlsx", "pdf"],
    run: (deps, documentId) =>
      createSheet(
        {
          outline: {
            title: "Donations 2026",
            columns: ["Month", "Amount"],
            columnFormats: ["general", "currency"],
            rows: [["Jan", 100], ["Feb", 300], ["Total", { formula: "=SUM(B2:B3)" }]],
            documentId,
          },
        },
        deps,
      ),
  },
  {
    family: "drawing",
    formats: ["odg", "svg", "pdf"],
    run: (deps, documentId) =>
      createDrawing(
        {
          outline: {
            title: "Intake flow",
            shapes: [{ id: "intake", label: "Intake" }, { id: "vet", label: "Vet check", kind: "diamond" }, { id: "foster", label: "Foster" }],
            connectors: [{ from: "intake", to: "vet" }, { from: "vet", to: "foster", label: "healthy" }],
            documentId,
          },
        },
        deps,
      ),
  },
];

describe.skipIf(!ready)("render-family tools against the real dpf-doctools image", () => {
  it.each(EXAMPLES)(
    "turns a $family outline into a stored branded office file, a pdf and page previews, then revises it as version 2",
    async ({ family, formats, run }) => {
      const store = memoryStore();
      const deps = pipeline(store);

      const created = await run(deps);
      if (!created.ok) throw new Error(`${created.reason}: ${created.error}`);
      expect(created.data).toMatchObject({ documentId: "DOC-E2E1", version: 1, revised: false, formats });
      expect(store.kinds.get("DOC-E2E1")).toBe(`generated-${family}`);

      const stored = [...store.blobs.values()];
      for (const format of formats) {
        const file = stored.find((blob) => blob.mime === RENDER_FORMAT_MIME[format as RenderFormat]);
        expect(file && MAGIC[format]!(file.bytes), `${family} ${format}`).toBe(true);
      }

      const preview = store.renditions.find((row) => row.versionId === "DOC-E2E1-v1" && row.kind === "preview");
      expect(preview?.mimeType).toBe(PREVIEW_MANIFEST_MIME);
      const manifest = parsePreviewManifest(store.blobs.get(preview!.blobId!)!.bytes);
      expect(manifest?.pages.length).toBeGreaterThan(0);
      for (const page of manifest!.pages) {
        expect(store.blobs.get(page.blobId)?.bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
      }

      const revised = await run(deps, "DOC-E2E1");
      if (!revised.ok) throw new Error(`${revised.reason}: ${revised.error}`);
      expect(revised.data).toMatchObject({ documentId: "DOC-E2E1", version: 2, revised: true });
    },
    480_000,
  );
});
