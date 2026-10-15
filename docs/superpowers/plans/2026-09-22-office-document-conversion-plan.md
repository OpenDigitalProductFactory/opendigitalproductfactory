---
status: draft
---

# Office document engine: implementation plan

_Umbrella `BI-815D40C6` · Epic `EP-8DC217EB` · Design [2026-09-22-office-document-conversion-design.md](../specs/2026-09-22-office-document-conversion-design.md) · Decision `DI-3638BEF46CE9`._

> Each slice gets its own backlog item, branch and pull request. Claim it with its `workShape`, and write the test first. A docker test that could not run is **skipped**, never passed. Each slice's full steps live in its backlog item body.

## Order and dependencies

```
S0 BI-65D65EC0 ───────────────────────────────┐
S1 BI-15D69168 ── S2 BI-52E565DA ──┬── S3 BI-81524041 ── S9 BI-D1B40D43
                                   ├── S4 BI-9D43CBEF ── S5 BI-4865EB4D
                                   └── S6 BI-3A0E5413 ──┬── S7 BI-543819B1
                                                        └── S8 BI-4C17BF51
```

S0 and S1 run in parallel. After S2, three lines run independently: ingest (S3 → S9), store (S4 → S5) and produce (S6 → S7, S8).

## Deliverables

| Key | BI | Shippable alone | Depends on | Requirements | Contracts | Flows | Verification |
|---|---|---|---|---|---|---|---|
| S0 | BI-65D65EC0 | yes | — | OBJ-ODC-HONEST | `ParsedFileContent` unsupported variant | upload · onboarding capture · sheet import | AC-ODC-001 |
| S1 | BI-15D69168 | yes | — | OBJ-ODC-CONTAIN, OBJ-ODC-FOOTPRINT | `dpf-convert` CLI + exit codes; release manifest image entry | release publish | AC-ODC-002, AC-ODC-003 |
| S2 | BI-52E565DA | yes | S1 | OBJ-ODC-CONTAIN, OBJ-ODC-FOOTPRINT | `convertDocument`; `getConverterAvailability` | portal → docker socket → one-shot container | AC-ODC-003, AC-ODC-004 |
| S3 | BI-81524041 | yes | S0, S2 | OBJ-ODC-INGEST | format routing table | upload · onboarding capture · sheet import | AC-ODC-005 |
| S4 | BI-9D43CBEF | yes | S2 | OBJ-ODC-RENDITION, OBJ-ODC-HONEST | `DocumentRenditionKind` enum; `doc_load` renditions | doc_save → rendition job → index | AC-ODC-006, AC-ODC-007 |
| S5 | BI-4865EB4D | yes | S2, S4 | OBJ-ODC-PRODUCE | export action; flat-ODS Workbook writer | document page export · Workbooks export | AC-ODC-008 |
| S6 | BI-3A0E5413 | yes | S1, S2 | OBJ-ODC-PRODUCE, OBJ-ODC-FOOTPRINT | `renderDocument`; `dpf-render` | spec → template → office file + previews | AC-ODC-009, AC-ODC-010 |
| S7 | BI-543819B1 | yes | S6 | OBJ-ODC-PRODUCE | `create_presentation` + marketing skill | coworker outline → deck | AC-ODC-009 |
| S8 | BI-4C17BF51 | yes | S2, S6 | OBJ-ODC-PRODUCE | EA view drawing spec; Visio import candidates | EA view export · discovery import review | AC-ODC-010 |
| S9 | BI-D1B40D43 | yes | S3 | OBJ-ODC-FOOTPRINT | engine-backed parsing; sbom deny list | all ingestion paths | AC-ODC-011 |

## Slices

**S0 · `fix/office-format-sniffing` (small).**
- Add real fixtures: `.doc` (an OLE file), `.rtf`, `.docx`, and a `.docx` renamed to `.doc`.
- Add `sniffOfficeContainer` to `file-parsers.ts`. It checks the OLE magic bytes, `{\rtf` and the ZIP header. For ZIP files, the `[Content_Types].xml` or `mimetype` entry decides between OOXML and ODF.
- Widen `ParsedFileContent`. Three callers show the reason: `file-upload.ts`, `capture-business-document.ts` and `sheet-import.ts`.
- Gate: vitest and the build.

**S1 · `feat/dpf-doctools-image`.**
- Write `Dockerfile.doctools`: Debian-slim pinned by digest, the distribution's `libreoffice-core/-writer/-calc/-impress/-draw`, `python3-uno`, `poppler-utils` and metric-compatible fonts. It runs as a non-root user.
- Write `tools/doctools/dpf-convert`: stdin in, stdout out, a per-run profile under `/tmp`, one filter table, `DPF_CONVERT_MAX_BYTES`, and fixed exit codes.
- Set macro security in `registrymodifications.xcu`: very high, macros off, linked content off.
- `smoke.sh` converts every fixture with `--network none --read-only` and asserts that the macro fixture's marker file is absent.
- Add a `publish-image.yml` entry that mirrors `dpf-promoter`: digest into the release manifest, the smoke test, and a size budget.
- Add an SBOM entry and a tool-evaluation record. Docs: install line.

**S2 · `feat/document-converter-runtime`.**
- `command.ts`, `buildConverterCommand`: a pure function patterned on `buildPromoterCommand`, carrying every hardening flag and an image pinned as `name@sha256:`.
- `convert.ts`, `convertDocument`: runs on `runProcessWithBudget` with an injected-runner test. It covers:
  - success;
  - `input-too-large` rejected before spawning;
  - a timeout that removes the container by name;
  - a concurrency cap of 2;
  - `conversion-failed`;
  - `converter-unavailable`.
- `availability.ts`, `getConverterAvailability`: cached for 60 s and registered as an optional dependency, so its absence is not an alert.
- Resolve `doctoolsImage` wherever `promoterImage` is resolved.
- Gate: a docker-gated `.doc` → PDF test. Docs: a watchlist row.

**S3 · `feat/converter-backed-ingestion`.**
- Route through M5's `parseDocument()` if it is on `main`, otherwise through `parseFileContent`.
- Write one routing test per family with a fake converter, following the format routing table, including the S0 fallback.
- Widen the upload `accept` lists. Size caps stay unchanged.
- UX check on the shared nonprod lease: a `.doc` in onboarding and an `.xls` in sheet import both produce content, and the page shows a message when the converter is off.
- Docs: supported formats.

**S4 · `feat/document-renditions`.**
- Migrate to the `DocumentRenditionKind (pdf, plain_text)` enum with a `USING` cast; unmappable rows are removed first.
- The rendition job in `renditions.ts` is triggered from the version save in `document-store.ts`. The office MIME list has one home: `conversion/formats.ts`.
- Index the text for full-text search and through `storeDocumentVector`. `doc_load` returns `renditions`.
- On the document page, add View PDF and Download original, following a UX fit review.
- Add a bounded backfill.
- Gate: the migration applied with and without rows, plus a `doc_save` → `doc_search` round trip on the portal.

**S5 · `feat/office-export`.**
- Documents go markdown → HTML → `convertDocument` and come out as docx, odt or pdf renditions. Widening the enum requires a migration.
- The export action goes on the document page, and `doc_load` gains `exportFormat`.
- The flat-ODS Workbook writer (`lib/workbooks/export-fods.ts`) turns the model into flat ODS, which the engine converts to xlsx or ods, with formats and a chart.
- Round-trip tests re-import through S3.
- Once parity holds, delete `grid-xlsx.ts`.
- UX check on both controls.

**S6 · `feat/document-generation-engine`.**
- `dpf-render.py` on `python3-uno`:
  - reads `{ template, content, formats }` as JSON on stdin;
  - fills placeholders, masters, tables and charts;
  - streams the office file and PNG previews to stdout.
- `spec.ts` validates the deck, report, letter, sheet and drawing specs with the existing validator helpers, before any container runs.
- `renderDocument` returns an office file + previews, stored as a Document with renditions.
- `brand-master.ts` builds masters from the `Organization` brand.
- Gate: a determinism test and a docker-gated render.

**S7 · `feat/marketing-presentations`.**
- `create_presentation` maps a coworker outline to a deck spec. A revision creates a new `DocumentVersion`.
- Grant it to the marketing coworker in `agent_registry.json`.
- Add a marketing skill under `packages/dpf-skill-pack/skills/create-presentation/`.
- Show slide previews on the document page.
- UX check: ask the coworker for a 6-slide deck and open the `.pptx` in Impress.

**S8 · `feat/ea-diagram-exchange`.**
- The EA view drawing spec carries positions, sizes, labels, resolved `--dpf-*` layer colours, and connectors.
- EA view export produces `.odg/.svg/.pdf/.png` through S6.
- Discovery import review: `.vsd/.vsdx/.odg` are converted by the engine, and their shape and connector text becomes Visio import candidates in the EA review flow. Nothing is auto-committed.
- UX check on both.

**S9 · `refactor/retire-in-process-document-parsers`.**
- Precondition: the converter is available on both compose install shapes, and every other watchlist target has its degraded behaviour recorded. If either is not true, stop and record the finding.
- The existing fixtures pass through the engine. After that, all ingestion paths use the engine.
- Remove `mammoth`, `read-excel-file` and `pdf-parse`, add them to the sbom deny list, and ratchet down `sbom/baseline.json`.
- Gate: `pnpm why` returns nothing for all three, and the image size delta is recorded.
- Delivered 2026-09-26 (BI-D1B40D43). The precondition was met by BI-4E18BC28, BI-B470264D and BI-698B7F9A, and is proven against the real registry by `apps/web/lib/self-upgrade/doctools-source-lineage.network.test.ts`. One change from the BI's wording: Word-family files convert to `.odt` and sheets to `.ods`, and DPF reads that one format itself (`apps/web/lib/shared/odf-content.ts`, on the XML parser the S8 flat-ODG import already uses), instead of HTML and CSV. ODF keeps headings, typed cells (numbers, booleans, dates) and every sheet the Workbooks import needs, and those targets are already in the published image, so a portal paired with an older `dpf-doctools` still reads every format. PDF text uses a new `dpf-convert` mode, `--to txt --from pdf`, which runs `pdftotext` directly under the same containment; an older image still yields text, through LibreOffice. The dev-time reference-data generators read `.xlsx` with an in-house reader on fflate (`packages/db/scripts/lib/excel-sheet-reader.ts`), verified by regenerating both committed JSON files byte for byte.

## Out of scope

- In-browser office editing: rejected under `absorb-dont-adopt`.
- Absorbing Apache OpenOffice.
- The react-pdf invoice: covered by M5.
- `analyze_brand_document`.
- unoserver, until conversion volume justifies it.
