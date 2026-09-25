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
| Store | `apps/web/lib/documents/generation/render-store.ts` | Saves the office file as a DocumentVersion's content with the text layer inline, so full-text and vector search find it. It writes `pdf` and `plain_text` renditions the way S4's rendition job does. That job, which the version save also requests, then finds both kinds already present and skips a second engine run. Previews and any extra formats are stored as blobs and returned (see Seams). |

## Templates and placeholders

- Deck masters are named `dpf-title`, `dpf-section` and `dpf-content`. `dpf-render` assigns them by slide layout and falls back to the first master.
- Report and letter masters carry a `{{body}}` paragraph where content is inserted. Without one, content is appended.
- `{{name}}` placeholders anywhere in a template (headers, footers, masters, cells) are replaced from `title`, `subject`, `author`, `date` and the spec's `fields`.
- Chart series colours and diagram shape colours come from the brand theme (`chartColours`, `shapeFill`, `shapeStroke`, `shapeText`). A template cannot carry those.
- Templates are flat ODF only. `dpf-render` refuses any template with embedded objects, scripts, event bindings, DDE or external links. That screen is why it may lift `DisableActiveContent` for its own run: charts are embedded objects. See the [tool evaluation addendum](../security/tool-evaluations/2026-09-24-libreoffice-headless.md#addendum-2026-09-25-dpf-render-bi-3a0e5413-slice-s6).

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

## Seams

- **Previews.** S4 owns `DocumentRenditionKind` (`pdf`, `plain_text`) and defines no preview kind. Previews are therefore content-addressed DocumentBlobs, returned by `saveRenderedDocument` in page order. S7 (`BI-543819B1`) shows them on the document page, and a `preview` kind belongs there.
- **Callers.** S7 adds `create_presentation`. S8 (`BI-4C17BF51`) adds the EA drawing export: `apps/web/lib/ea/view-drawing.ts` maps an EA view to a `drawing` spec, and `view-drawing-export.ts` renders it for the view's **Export** menu (one file per download) and for the `export_ea_view_drawing` coworker tool (stored with `saveRenderedDocument`).
- **Diagram import.** The S8 import runs the other direction on `dpf-convert`, not `dpf-render`: `--to fodg` turns a .vsd, .vsdx or .odg into flat XML that `apps/web/lib/ea/diagram-import/parse-flat-odg.ts` reads for shape and connector text, and `--to svg` gives the reviewer a picture. `odg`, `fodg` and `svg` are in the converter's filter table and in `CONVERTER_TARGET_MIME`, which `RENDER_FORMAT_MIME` now reads too. The candidates are EA review proposals, never model writes.
- **Drawing shapes keep their box.** `dpf-render` turns off Draw's auto-grow on labelled shapes and centres the label, so a shape is exactly the size the spec asks for.

## Verification

- `apps/web/lib/documents/generation/*.test.ts` covers spec validation, the tar reader, the runner contract with an injected runner, brand masters and storage.
- `render.docker.test.ts` needs `DPF_DOCTOOLS_TEST_IMAGE` set to a pinned local image, and reports SKIPPED otherwise. It renders a branded deck (a title slide and five content slides, including a chart and an image) to pptx, pdf and six previews. It renders every other family and checks determinism.
- `tools/doctools/smoke.sh` section 5 runs the engine under the release containment flags.
