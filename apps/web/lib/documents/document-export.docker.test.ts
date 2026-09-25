// Docker-gated end-to-end test of document export (BI-4865EB4D, AC-ODC-008).
//
// Runs only when DPF_DOCTOOLS_TEST_IMAGE names a pinned dpf-doctools image
// (`name@sha256:…`, or the local image id `sha256:…` of a fresh
// `docker build -f Dockerfile.doctools`) AND docker answers. Otherwise every
// case is reported SKIPPED, never passed.
//
// A markdown fixture with headings, a table, lists and an image goes through
// the real pipeline (markdown -> HTML -> dpf-convert) to .docx and is then
// re-imported through the platform's existing .docx reader (parseDocx, and
// mammoth's HTML for the table), so structure is proven by the same code that
// ingests a customer's file.

import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {},
  DocumentRenditionKind: { pdf: "pdf", plain_text: "plain_text", docx: "docx", odt: "odt" },
}));

import { isPinnedImageReference } from "./conversion/command";
import { convertDocument, createConversionLimiter } from "./conversion/convert";
import { exportDocumentVersion, type DocumentExportDeps } from "./document-export";
import { parseDocx } from "@/lib/shared/file-parsers";

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

const ready = dockerHasImage(IMAGE);
const limiter = createConversionLimiter(2);
const realConvert: DocumentExportDeps["convert"] = (request) =>
  convertDocument(request, { resolveImage: async () => ({ status: "pinned", image: IMAGE }), limiter });

// A 4x4 opaque PNG, so the exported file must carry a real embedded picture.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGOQizoBRwzEcQD9oxQB2jyOrgAAAABJRU5ErkJggg==";

const FIXTURE = [
  "# Quarterly Board Pack",
  "",
  "Adoption rose across every region this quarter.",
  "",
  "## Regional Figures",
  "",
  "| Region | Units | Owner |",
  "| :--- | ---: | --- |",
  "| North | 42 | Avery |",
  "| South | 17 | Blake |",
  "",
  "## Next Steps",
  "",
  "- Hire two coordinators",
  "- Open the east office",
  "",
  "1. Approve the budget",
  "2. Publish the plan",
  "",
  `![Company logo](${PNG})`,
].join("\n");

function harness(format: "docx" | "odt" | "pdf") {
  const blobs = new Map<string, Buffer>();
  const upserts: Array<{ create: { renditionKind: string; blobId: string } }> = [];
  const version = { id: "ver-1", version: 1, contentFormat: "text/markdown", contentText: FIXTURE, contentBlob: null, renditions: [] };
  const deps: DocumentExportDeps = {
    db: {
      document: { findUnique: vi.fn(async () => ({ title: "Quarterly Board Pack", currentVersion: version, versions: [version] })) },
      documentRendition: {
        upsert: vi.fn(async (args: { create: { renditionKind: string; blobId: string } }) => {
          upserts.push(args);
          return { id: "r" };
        }),
      },
    } as never,
    convert: realConvert,
    readBlob: async () => Buffer.alloc(0),
    storeBlob: async (bytes) => {
      const id = `blob-${blobs.size + 1}`;
      blobs.set(id, bytes);
      return { id };
    },
  };
  return { deps, blobs, upserts, run: () => exportDocumentVersion({ documentId: "DOC-1", format }, deps) };
}

describe.skipIf(!ready)("document export against the real dpf-doctools image", () => {
  it("exports markdown to a .docx whose headings, table cells, lists and image survive re-import", async () => {
    const { run, upserts, blobs } = harness("docx");
    const out = await run();
    if (!out.ok) throw new Error(`export failed: ${out.reason}: ${out.error}`);
    const docx = out.data.bytes;
    expect(docx.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(upserts[0]!.create.renditionKind).toBe("docx");
    expect(blobs.get(upserts[0]!.create.blobId)).toEqual(docx);

    const parsed = await parseDocx(docx);
    expect(parsed.sections?.map((s) => s.heading)).toEqual(["Quarterly Board Pack", "Regional Figures", "Next Steps"]);
    expect(parsed.fullText).toContain("Hire two coordinators");
    expect(parsed.fullText).toContain("Approve the budget");

    const mammoth = await import("mammoth");
    const html = (await mammoth.convertToHtml({ buffer: docx })).value;
    expect(html).toMatch(/<h1>Quarterly Board Pack<\/h1>/);
    expect(html).toMatch(/<table>/);
    for (const cell of ["Region", "Units", "Owner", "North", "42", "Avery", "South", "17", "Blake"]) {
      expect(html).toMatch(new RegExp(`<t[dh]>(<p>)?${cell}(</p>)?</t[dh]>`));
    }
    expect(html).toMatch(/<li>(<p>)?Hire two coordinators/);
    expect(html).toMatch(/<img [^>]*src="data:image\/png;base64,/);
  }, 240_000);

  it("exports the same markdown to .odt and to PDF", async () => {
    const odt = await harness("odt").run();
    if (!odt.ok) throw new Error(`odt export failed: ${odt.reason}: ${odt.error}`);
    expect(odt.data.bytes.subarray(30, 38).toString("latin1")).toBe("mimetype");
    expect(odt.data.bytes.includes(Buffer.from("application/vnd.oasis.opendocument.text"))).toBe(true);

    const pdf = await harness("pdf").run();
    if (!pdf.ok) throw new Error(`pdf export failed: ${pdf.reason}: ${pdf.error}`);
    expect(pdf.data.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  }, 240_000);
});
