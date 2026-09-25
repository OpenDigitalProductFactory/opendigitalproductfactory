// Docker-gated proof of the embedded-object split (BI-BFF142A1, AC-2 and AC-3).
//
// Runs only when DPF_DOCTOOLS_TEST_IMAGE names a pinned dpf-doctools image
// (`name@sha256:…`, or the local image id `sha256:…` of a fresh
// `docker build -f Dockerfile.doctools`) AND docker has it. Otherwise every
// case is reported SKIPPED, never passed.
//
// The customer files are made at test time by the engine itself: a flat ODS
// (the Workbook export fixture, with its bar chart) and a flat ODT with a chart
// go through dpf-render's trusted document mode to a real .ods and .odt.
// Measured, and asserted here:
//   - dpf-convert (the customer path, DisableActiveContent on) still reads a
//     zipped .ods/.odt with a chart: ingestion gets the content, the PDF keeps
//     the chart's picture. Refusing those up front would be a regression.
//   - dpf-convert refuses a flat ODS that carries a chart object (AC-2). A
//     rendition of such a file records `embedded-objects`, and ingestion says
//     the file contains embedded objects, not that it is damaged (AC-3).

import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {}, DocumentRenditionKind: { pdf: "pdf", plain_text: "plain_text" } }));
import { isPinnedImageReference } from "@/lib/documents/conversion/command";
import { convertDocument, createConversionLimiter } from "@/lib/documents/conversion/convert";
import { renderFlatDocument } from "@/lib/documents/generation/render-flat";
import { buildFlatOds } from "@/lib/workbooks/export-fods";
import { WORKBOOK_EXPORT_FIXTURE } from "@/lib/workbooks/export-fixture";
import { generateDocumentRenditions, type RenditionDeps } from "@/lib/documents/renditions";
import { convertForIngestion, parseFileContent, type ConvertForIngestion } from "./file-parsers";
import { odfEmbeddedObjects } from "./odf-embedded-objects";

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
const resolveImage = async () => ({ status: "pinned" as const, image: IMAGE });
const limiter = createConversionLimiter(2);
const convert: ConvertForIngestion = (request) => convertDocument(request, { resolveImage, limiter });

/** A flat ODT with one paragraph and a bar chart that keeps its numbers in its own local table. */
function flatOdtWithChart(): string {
  const ns = [
    'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
    'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
    'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
    'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
    'xmlns:chart="urn:oasis:names:tc:opendocument:xmlns:chart:1.0"',
  ].join(" ");
  const cell = (v: string | number) =>
    typeof v === "number"
      ? `<table:table-cell office:value-type="float" office:value="${v}"><text:p>${v}</text:p></table:table-cell>`
      : `<table:table-cell office:value-type="string"><text:p>${v}</text:p></table:table-cell>`;
  const rows = [["North", 47], ["East", 20], ["South", 30]] as const;
  const chart = [
    `<office:document ${ns} office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.chart"><office:body><office:chart>`,
    `<chart:chart chart:class="chart:bar" svg:width="12cm" svg:height="7cm">`,
    `<chart:plot-area table:cell-range-address="local-table.$A$1:.$B$4" chart:data-source-has-labels="both">`,
    `<chart:axis chart:dimension="x" chart:name="primary-x"><chart:categories table:cell-range-address="local-table.$A$2:.$A$4"/></chart:axis>`,
    `<chart:axis chart:dimension="y" chart:name="primary-y"/>`,
    `<chart:series chart:class="chart:bar" chart:values-cell-range-address="local-table.$B$2:.$B$4" chart:label-cell-address="local-table.$B$1"/>`,
    `</chart:plot-area>`,
    `<table:table table:name="local-table"><table:table-header-columns><table:table-column/></table:table-header-columns><table:table-columns><table:table-column/></table:table-columns>`,
    `<table:table-header-rows><table:table-row><table:table-cell><text:p/></table:table-cell>${cell("Adoptions")}</table:table-row></table:table-header-rows>`,
    `<table:table-rows>${rows.map(([label, value]) => `<table:table-row>${cell(label)}${cell(value)}</table:table-row>`).join("")}</table:table-rows></table:table>`,
    `</chart:chart></office:chart></office:body></office:document>`,
  ].join("");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<office:document ${ns} office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text"><office:body><office:text>`,
    `<text:p>Adoptions by region DPFCHARTSENTINEL</text:p>`,
    `<text:p><draw:frame draw:name="Adoptions" text:anchor-type="as-char" svg:width="12cm" svg:height="7cm"><draw:object>${chart}</draw:object></draw:frame></text:p>`,
    `</office:text></office:body></office:document>`,
  ].join("\n");
}

async function customerFile(ext: "fods" | "fodt", xml: string, format: "ods" | "odt"): Promise<Buffer> {
  const out = await renderFlatDocument({ ext, xml, formats: [format] } as never, { resolveImage, limiter });
  if (!out.ok) throw new Error(`making the .${format} fixture failed: ${out.reason}: ${out.error}`);
  return out.data[0]!.bytes;
}

/** A rendition run over one stored version, with the database faked and the engine real. */
async function renditionOf(bytes: Buffer, contentFormat: string) {
  const events: Array<{ data: { reason: string } }> = [];
  const db = {
    documentVersion: {
      findUnique: async () => ({
        id: "ver-1",
        version: 1,
        contentFormat,
        summary: null,
        contentBlob: { id: "blob-1", storageKey: "k", sha256: "a".repeat(64) },
        renditions: [],
        document: { id: "doc-1", documentId: "DOC-1", organizationId: "org-1", title: "Budget", documentKind: "report", currentState: "draft", ownerPrincipalId: null, currentVersionId: "ver-1", tags: [] },
      }),
    },
    documentRendition: { upsert: async () => ({ id: "r" }) },
    document: { update: async () => ({ id: "doc-1" }) },
    documentLifecycleEvent: { findFirst: async () => null, create: async (args: { data: { reason: string } }) => (events.push(args), { id: "e" }) },
  };
  const deps: Partial<RenditionDeps> = {
    db: db as never,
    convert: (request) => convertDocument(request, { resolveImage, limiter }),
    readBlob: async () => bytes,
    storeBlob: async () => ({ id: "stored" }),
    indexVector: async () => true,
    now: () => new Date("2026-09-25T12:00:00Z"),
  };
  return { outcome: await generateDocumentRenditions("ver-1", deps), events };
}

const ODS_MIME = "application/vnd.oasis.opendocument.spreadsheet";

describe.skipIf(!ready)("embedded-object ODF files against the real dpf-doctools image", () => {
  it("a zipped .ods and .odt with a chart still convert through the hardened converter, and ingestion reads them", async () => {
    const ods = await customerFile("fods", buildFlatOds(WORKBOOK_EXPORT_FIXTURE), "ods");
    const odt = await customerFile("fodt", flatOdtWithChart(), "odt");
    expect(odfEmbeddedObjects(ods)?.length, "the .ods manifest names its chart").toBeGreaterThan(0);
    expect(odfEmbeddedObjects(odt)?.length, "the .odt manifest names its chart").toBeGreaterThan(0);

    const sheet = await parseFileContent(ods, ODS_MIME, "budget.ods", { convert });
    expect(sheet?.type).toBe("spreadsheet");
    const text = await parseFileContent(odt, "", "report.odt", { convert });
    if (text?.type !== "document") throw new Error(`.odt: expected document, got ${JSON.stringify(text)}`);
    expect(text.fullText).toContain("DPFCHARTSENTINEL");
    const { outcome } = await renditionOf(ods, ODS_MIME);
    expect(outcome).toEqual({ status: "rendered", kinds: ["pdf", "plain_text"] });
  }, 600_000);

  it("dpf-convert refuses a flat ODS with a chart object; ingestion and renditions name the embedded objects", async () => {
    const fods = Buffer.from(buildFlatOds(WORKBOOK_EXPORT_FIXTURE), "utf8");
    const refused = await convertDocument({ input: fods, from: "ods", to: "pdf" }, { resolveImage, limiter });
    expect(refused, "dpf-convert keeps DisableActiveContent on").toMatchObject({ ok: false, reason: "conversion-failed" });

    const ingested = await convertForIngestion(fods, { family: "sheet", from: "ods", to: "xlsx", fallback: "opendocument" }, convert);
    expect(ingested.ok).toBe(false);
    if (!ingested.ok) expect(ingested.error).toContain("contains embedded objects (such as charts) that DPF does not open");

    const { outcome, events } = await renditionOf(fods, ODS_MIME);
    expect(outcome).toEqual({ status: "failed", reason: "embedded-objects", kind: "pdf" });
    expect(events[0]!.data.reason).toMatch(/^rendition embedded-objects: pdf of v1\. This file contains embedded objects/);
  }, 600_000);
});
