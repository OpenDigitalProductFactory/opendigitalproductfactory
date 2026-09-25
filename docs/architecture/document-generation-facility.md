# Document generation facility

**Backlog item:** `BI-3A0E5413` (slice S6 of `BI-815D40C6`) · **Design:** [office document engine](../superpowers/specs/2026-09-22-office-document-conversion-design.md) · **Plan:** [§S6](../superpowers/plans/2026-09-22-office-document-conversion-plan.md)

One shared facility turns a described document into office files. A caller (a
coworker tool, an export, the EA canvas) writes a **content spec**. The
`dpf-doctools` engine lays the spec out inside a **brand master** and returns
the office file, a PDF, PNG page previews and the text layer. Nobody writes
office XML by hand, and no surface keeps its own renderer.

```
content spec ──▶ spec.ts (validate) ──▶ render.ts ──docker run (one-shot)──▶ dpf-render
                      │ field-path errors      │ template: brand-master.ts          │ fills template, exports
                      ▼                        │ (Organization ─▶ flat ODF)         ▼
                 no container runs             ◀──────────── tar on stdout ─────────┘
                                               │ files, previews, text, page count
                                               ▼
                                  render-store.ts ─▶ Document + DocumentVersion + renditions
```

## Parts

| Part | File | Role |
| --- | --- | --- |
| Content spec | `apps/web/lib/documents/generation/spec.ts` | Five families: `deck`, `report`, `letter`, `sheet`, `drawing`. Validated with zod, the platform's existing validator. Invalid specs are refused before any container runs, with dotted field paths such as `content.slides.2.chart.series.0.values.1`. Bounds cover slides, rows, series, image bytes and formula functions. |
| Runtime | `apps/web/lib/documents/generation/render.ts` | `renderDocument({ templateRef, content, formats, previews })`. It runs on the S2 runtime: the same containment flags as `dpf-convert` (`hardenedRunArgs` in `conversion/command.ts` is their one home), the same concurrency cap (`sharedDoctoolsLimiter`) and a 240 s budget. Failures are typed: `invalid-spec`, `converter-unavailable`, `input-too-large`, `timeout`, `render-failed`. |
| Engine | `tools/doctools/dpf-render` (+ `dpf_render_uno.py`, `dpf_render_families.py`) | Python on the image's `python3-uno` bridge. It opens a blank document or a flat-ODF template, fills it, and exports each format. Previews come from `pdftoppm` and the text layer from `pdftotext`. Output is a tar stream with every entry dated 0. Exit codes: 2 bad request, 3 failed, 4 too large or empty, 124 timeout. |
| Brand masters | `apps/web/lib/documents/generation/brand-master.ts`, `brand-master-xml.ts` | One flat-ODF master per family, built from `Organization` only (name, address, logo, `designSystem` palette and fonts), with neutral defaults where the record is silent. Each master is the Document `BRANDMASTER-<org id>-<family>`. Its bytes are deterministic, so their SHA-256 is the brand fingerprint: a render reuses the current version and writes a new one the first time the brand has changed. |
| Store | `apps/web/lib/documents/generation/render-store.ts` | Saves the office file as a DocumentVersion's content with the text layer inline, so full-text and vector search find it. It writes `pdf` and `plain_text` renditions the way S4's rendition job does. That job, which the version save also requests, then finds both kinds already present and skips a second engine run. Previews are stored as blobs and recorded as the version's `preview` rendition (see Previews). Extra formats are stored as blobs and returned. |
| Trusted document export | `apps/web/lib/documents/generation/render-flat.ts` | `renderFlatDocument({ ext, xml, formats })`: `dpf-render`'s document mode for flat ODF that DPF wrote itself (`fods` to `xlsx`/`ods`/`pdf`, `fodt` to `docx`/`odt`/`pdf`). It uses the same runtime as `renderDocument` and returns only the files: no previews, no text. The Workbook export (`lib/workbooks/export-workbook.ts`) is its first caller, because its flat ODS embeds a bar chart (`BI-BFF142A1`). |
| Presentations | `apps/web/lib/documents/generation/create-presentation.ts` | The `create_presentation` tool (document pack, `document_write`). A coworker's outline maps to a deck spec, one outline slide per slide, with the layout inferred from what each slide carries. It renders in the organization's brand master as `.pptx` + PDF with one preview per slide. A revision passes the presentation's `documentId` and becomes the next DocumentVersion; only a `generated-deck` document can be revised this way. The marketing strategist holds the grant and the `create-presentation` skill. |

## Templates and placeholders

- Deck masters are named `dpf-title`, `dpf-section` and `dpf-content`. `dpf-render` assigns them by slide layout and falls back to the first master.
- Report and letter masters carry a `{{body}}` paragraph where content is inserted. Without one, content is appended.
- `{{name}}` placeholders anywhere in a template (headers, footers, masters, cells) are replaced from `title`, `subject`, `author`, `date` and the spec's `fields`.
- Chart series colours and diagram shape colours come from the brand theme (`chartColours`, `shapeFill`, `shapeStroke`, `shapeText`). A template cannot carry those.
- Templates are flat ODF only. `dpf-render` refuses any template with embedded objects, scripts, event bindings, DDE or external links. That screen is why it may lift `DisableActiveContent` for its own run: charts are embedded objects. See the [tool evaluation addendum](../security/tool-evaluations/2026-09-24-libreoffice-headless.md#addendum-2026-09-25-dpf-render-bi-3a0e5413-slice-s6).

## Trusted path and customer files (founder decision 2026-09-25, `BI-BFF142A1`)

Two paths reach the engine, and they have different trust:

| Path | Input | `DisableActiveContent` | Embedded objects |
| --- | --- | --- | --- |
| `dpf-convert` (`convertDocument`) | Customer files: uploads, stored versions, imports | On, always (the baked profile) | Not opened. A flat ODS with an inline chart is refused. A zipped `.ods`/`.odt` with a chart still converts: its text is read, and its PDF shows the chart's stored picture. |
| `dpf-render` (`renderDocument`, `renderFlatDocument`) | Only what DPF generated: content specs, brand masters, and flat ODF that DPF wrote | Lifted in the per-run profile copy | Charts only. The engine builds them from validated numbers (specs), or accepts them as inline chart sub-documents that pass the same screen as templates (document mode). |

- **Document mode screen.** The document must be `fods` or `fodt` of the matching media type. Each `draw:object` must hold exactly one inline `office:document` of the chart media type, with no attribute other than `draw:notify-on-update-of-ranges`, and at most 16 of them. Each chart body, and the rest of the document, pass the template screen (no scripts, event bindings, DDE, applets, plugins, OLE objects, floating frames or external links). A refused document exits 2. See the [tool evaluation addendum](../security/tool-evaluations/2026-09-24-libreoffice-headless.md#addendum-2026-09-25-the-trusted-document-path-bi-bff142a1).
- **Customer files with embedded objects.** When the converter refuses an OpenDocument file, ingestion (`convertForIngestion`) and renditions check it with `lib/shared/odf-embedded-objects.ts`. The check reads the package manifest, or the object elements of a flat document. A file that embeds objects gets the plain-language "contains embedded objects (such as charts) that DPF does not open" result. For renditions, the lifecycle reason is `embedded-objects`.
- **Macros stay off on both paths.** The smoke test's macro probe runs the auto-run fixture under the hardened profile, through `dpf-convert`, and under the render profile. The marker must stay absent each time.

## Determinism

The same spec, template and `issuedAt` produce the same text layer, page count
and manifest. On LibreOffice 25.2 they also produce byte-identical previews.
Document properties take their dates from `issuedAt`. The PDF and office
containers still carry engine-generated identifiers, so their bytes are not
compared. `smoke.sh` and `render.docker.test.ts` both render the deck twice and
compare the results.

## Degraded behaviour

With no docker socket or no pinned `doctoolsImage`, `renderDocument` returns
`converter-unavailable` without spawning anything. This is the same contract as
conversion, [watchlist](../install/platform-support-watchlist.md) row D18.

## Previews

`DocumentRenditionKind` has a `preview` member (S7, `BI-543819B1`). A version
holds one rendition per kind, and a deck has one preview per slide, so the
`preview` rendition's blob is a small JSON manifest
(`apps/web/lib/documents/preview-manifest.ts`) listing the page PNGs, each a
content-addressed DocumentBlob, in page order. The manifest carries no
`contentText`, so it adds nothing to full-text search. The document page lists
the pages and `GET /api/documents/:documentId/previews/:page` serves one image
(`apps/web/lib/documents/document-previews.ts`), checking the blob's digest
against the manifest. Only generated documents have previews; an uploaded
office file gets S4's PDF and text.

## Seams

- **Callers.** `create_presentation` (S7) is the first caller. S8 (`BI-4C17BF51`) adds the EA drawing export.

## Verification

- `apps/web/lib/documents/generation/*.test.ts` covers spec validation, the tar reader, the runner contract with an injected runner, brand masters and storage.
- `render.docker.test.ts` needs `DPF_DOCTOOLS_TEST_IMAGE` set to a pinned local image, and reports SKIPPED otherwise. It renders a branded deck (a title slide and five content slides, including a chart and an image) to pptx, pdf and six previews. It renders every other family and checks determinism.
- `tools/doctools/smoke.sh` section 5 runs the engine under the release containment flags.
- `export-workbook.docker.test.ts` and `lib/shared/odf-embedded-objects.docker.test.ts` (same gate) cover `BI-BFF142A1`. The first exports the Workbook fixture to `.xlsx`, which must carry `xl/charts/chart1.xml` with a `c:barChart`, and to `.ods`, which must carry a chart sub-document. The second proves that the converter refuses a flat ODS with a chart, that zipped `.ods`/`.odt` files with charts still read, and that ingestion and renditions show the embedded-objects result. `smoke.sh` section 6 checks the same split against the built image.
- `create-presentation.docker.test.ts` (same gate) runs a six-slide outline through `create_presentation` to a stored `.pptx`, a PDF and a six-page preview manifest, then revises it as version 2.
