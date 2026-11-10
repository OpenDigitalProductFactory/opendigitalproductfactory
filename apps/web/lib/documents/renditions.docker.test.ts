// Docker-gated end-to-end test of the rendition job (BI-9D43CBEF, AC-ODC-006).
//
// Runs only when DPF_DOCTOOLS_TEST_IMAGE names a pinned dpf-doctools image
// (`name@sha256:…`, or the local image id `sha256:…`) AND docker has it.
// Otherwise every case is reported SKIPPED, never passed.
//
// The .docx, .pptx and .pdf inputs are produced at test time from the committed
// flat-ODF fixtures by the image itself, so the repository carries no office
// binary (the *.docx LFS rule never applies). The job then runs against the
// real engine; only the database and blob storage are in-memory fakes.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {},
  DocumentRenditionKind: { pdf: "pdf", plain_text: "plain_text" },
}));

import { isPinnedImageReference } from "./conversion/command";
import { convertDocument, createConversionLimiter } from "./conversion/convert";
import { generateDocumentRenditions, type RenditionDeps } from "./renditions";

const IMAGE = process.env.DPF_DOCTOOLS_TEST_IMAGE?.trim() ?? "";
const FIXTURES = resolve(__dirname, "../../../../tools/doctools/fixtures");

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
const realConvert: RenditionDeps["convert"] = (request) =>
  convertDocument(request, { resolveImage: async () => ({ status: "pinned", image: IMAGE }), limiter });

async function officeFile(fixture: string, from: string, to: "docx" | "pptx"): Promise<Buffer> {
  const out = await realConvert({ input: readFileSync(resolve(FIXTURES, fixture)), from, to });
  if (!out.ok) throw new Error(`${fixture} -> ${to} failed: ${out.reason}: ${out.error}`);
  return out.data.bytes;
}

function harness(contentFormat: string, original: Buffer) {
  const renditions: Array<{ kind: string; contentText: string | null; blobId: string | null }> = [];
  const blobs = new Map<string, Buffer>();
  const indexed: string[] = [];
  const db = {
    documentVersion: {
      findUnique: vi.fn(async () => ({
        id: "ver-1",
        version: 1,
        contentFormat,
        summary: null,
        contentBlob: { id: "orig", storageKey: "k", sha256: "s" },
        renditions: [],
        document: {
          id: "doc-db-1", documentId: "DOC-1", organizationId: "org-1", title: "Fixture",
          documentKind: "report", currentState: "draft", ownerPrincipalId: null, currentVersionId: "ver-1", tags: [],
        },
      })),
    },
    documentRendition: {
      upsert: vi.fn(async (args: { create: { renditionKind: string; contentText: string | null; blobId: string | null } }) => {
        renditions.push({ kind: args.create.renditionKind, contentText: args.create.contentText, blobId: args.create.blobId });
        return { id: "r" };
      }),
    },
    document: { update: vi.fn(async () => ({})) },
    documentLifecycleEvent: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({})) },
  };
  const deps: Partial<RenditionDeps> = {
    db: db as never,
    convert: realConvert,
    readBlob: async () => original,
    storeBlob: async (bytes) => {
      const id = `blob-${blobs.size + 1}`;
      blobs.set(id, bytes);
      return { id };
    },
    indexVector: async (input) => {
      indexed.push(input.contentText ?? "");
      return true;
    },
  };
  return { deps, renditions, blobs, indexed, db };
}

describe.skipIf(!ready)("generateDocumentRenditions against the real dpf-doctools image", () => {
  it("renders a .docx to a PDF and indexed text", async () => {
    const docx = await officeFile("sample.fodt", "fodt", "docx");
    const h = harness("application/vnd.openxmlformats-officedocument.wordprocessingml.document", docx);

    expect(await generateDocumentRenditions("ver-1", h.deps)).toEqual({ status: "rendered", kinds: ["pdf", "plain_text"] });
    const pdf = h.renditions.find((r) => r.kind === "pdf")!;
    expect(h.blobs.get(pdf.blobId!)!.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const text = h.renditions.find((r) => r.kind === "plain_text")!;
    expect(text.contentText).toContain("DPFSENTINELWRITER");
    expect(h.indexed[0]).toContain("DPFSENTINELWRITER");
    expect(h.db.documentLifecycleEvent.create).not.toHaveBeenCalled();
  }, 240_000);

  it("renders a .pptx to a PDF and indexed text", async () => {
    const pptx = await officeFile("sample.fodp", "fodp", "pptx");
    const h = harness("application/vnd.openxmlformats-officedocument.presentationml.presentation", pptx);

    expect(await generateDocumentRenditions("ver-1", h.deps)).toEqual({ status: "rendered", kinds: ["pdf", "plain_text"] });
    expect(h.renditions.find((r) => r.kind === "plain_text")!.contentText).toContain("DPFSENTINELIMPRESS");
  }, 240_000);

  it("reads a PDF original for its text only, with no pdf rendition (BI-26CD1D1E)", async () => {
    const out = await realConvert({ input: readFileSync(resolve(FIXTURES, "sample.fodt")), from: "fodt", to: "pdf" });
    if (!out.ok) throw new Error(`sample.fodt -> pdf failed: ${out.reason}: ${out.error}`);
    const h = harness("application/pdf", out.data.bytes);

    expect(await generateDocumentRenditions("ver-1", h.deps)).toEqual({ status: "rendered", kinds: ["plain_text"] });
    expect(h.renditions.map((r) => r.kind)).toEqual(["plain_text"]);
    expect(h.blobs.size).toBe(0);
    expect(h.renditions[0]!.contentText).toContain("DPFSENTINELWRITER");
    expect(h.indexed[0]).toContain("DPFSENTINELWRITER");
    expect(h.db.documentLifecycleEvent.create).not.toHaveBeenCalled();
  }, 240_000);
});
