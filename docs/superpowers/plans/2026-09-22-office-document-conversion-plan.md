---
status: draft
---

# Office document engine: implementation plan

_Umbrella `BI-815D40C6` · Epic `EP-8DC217EB` · Design [2026-09-22-office-document-conversion-design.md](../specs/2026-09-22-office-document-conversion-design.md) · Decision `DI-3638BEF46CE9`._

> **For agentic workers:** one slice is one backlog item, one branch and one PR. Claim the slice's BI with its `workShape` before writing code. If a docker-dependent test could not run, report it as **skipped**, never as passed. Detail lives in each slice's BI body.

## Order and dependencies

```
S0 BI-65D65EC0 ───────────────────────────────┐
S1 BI-15D69168 ── S2 BI-52E565DA ──┬── S3 BI-81524041 ── S9 BI-D1B40D43
                                   ├── S4 BI-9D43CBEF ── S5 BI-4865EB4D
                                   └── S6 BI-3A0E5413 ──┬── S7 BI-543819B1
                                                        └── S8 BI-4C17BF51 (import half needs only S2)
```

S0 and S1 run in parallel. After S2, ingest (S3, S9), store (S4, S5) and produce (S6, S7, S8) are independent.

## Deliverables

| Key | BI | Shippable alone | Depends on | Requirements | Contracts | Flows | Verification |
|---|---|---|---|---|---|---|---|
| S0 | BI-65D65EC0 | yes | — | OBJ-ODC-HONEST | `ParsedFileContent` unsupported variant | upload · onboarding capture · sheet import | AC-ODC-001 |
| S1 | BI-15D69168 | yes | — | OBJ-ODC-CONTAIN, OBJ-ODC-FOOTPRINT | `dpf-convert` CLI + exit codes; release manifest image entry | release publish | AC-ODC-002, AC-ODC-003 |
| S2 | BI-52E565DA | yes (no caller yet; availability probe live) | S1 | OBJ-ODC-CONTAIN, OBJ-ODC-FOOTPRINT | `convertDocument` / `ConversionResult`; `getConverterAvailability` | portal → docker socket → one-shot container | AC-ODC-003, AC-ODC-004 |
| S3 | BI-81524041 | yes | S0, S2 | OBJ-ODC-INGEST | format routing table | upload · onboarding capture · sheet import | AC-ODC-005 |
| S4 | BI-9D43CBEF | yes | S2 | OBJ-ODC-RENDITION, OBJ-ODC-HONEST | `DocumentRenditionKind` enum; `doc_load` renditions | doc_save → rendition job → index → document page | AC-ODC-006, AC-ODC-007 |
| S5 | BI-4865EB4D | yes | S2, S4 | OBJ-ODC-PRODUCE | export action; flat-ODS Workbook writer | document page export · Workbooks export | AC-ODC-008 |
| S6 | BI-3A0E5413 | yes | S1, S2 | OBJ-ODC-PRODUCE, OBJ-ODC-FOOTPRINT | `renderDocument` + content-spec schemas; `dpf-render` | spec → template → office file + previews → Document | AC-ODC-009, AC-ODC-010 |
| S7 | BI-543819B1 | yes | S6 | OBJ-ODC-PRODUCE | `create_presentation` tool + marketing skill | coworker outline → deck | AC-ODC-009 |
| S8 | BI-4C17BF51 | yes | S2, S6 | OBJ-ODC-PRODUCE | EA view drawing spec; Visio import candidates | EA view export · discovery import review | AC-ODC-010 |
| S9 | BI-D1B40D43 | yes | S3 | OBJ-ODC-FOOTPRINT | engine-backed `.docx/.xlsx/.pdf` parsing; sbom deny list | all ingestion paths | AC-ODC-011 |

## S0 · Honest format detection — `fix/office-format-sniffing`, small

1. **Test first.** Add real fixtures under `apps/web/lib/shared/__fixtures__/office/`: `.doc` (OLE), `.rtf`, `.docx`, and a `.docx` renamed `.doc`. OLE and RTF must return `{ unsupported: true, format }`. The renamed file must parse. `fullText` must never contain RTF control words.
2. Add `sniffOfficeContainer(buffer)` to `file-parsers.ts`. It checks OLE magic, a `{\rtf` prefix, and a ZIP header; for ZIP, the `[Content_Types].xml` or `mimetype` entry separates OOXML from ODF.
3. Widen `ParsedFileContent`. The three callers (`file-upload.ts`, `capture-business-document.ts`, `sheet-import.ts`) show the reason.
4. Gate: vitest and the production build.

## S1 · `dpf-doctools` image — `feat/dpf-doctools-image`, medium

1. `Dockerfile.doctools`: Debian-slim, pinned by digest.
   - Install the distribution packages `libreoffice-core`, `libreoffice-writer`, `libreoffice-calc`, `libreoffice-impress`, `libreoffice-draw`, `python3-uno` and `poppler-utils`, plus metric-compatible fonts.
   - Run as the non-root user `doctools`.
2. `tools/doctools/dpf-convert` (POSIX sh):
   - Takes stdin and writes stdout, using `soffice --headless --convert-to` with a per-run profile under `/tmp`.
   - Keeps one filter table for pdf, docx, xlsx and txt; slides go to text through `pdftotext`.
   - Enforces `DPF_CONVERT_MAX_BYTES`, and uses the exit codes from the design.
3. `tools/doctools/registrymodifications.xcu` bakes in the security settings: macro security very high, macros off, linked-content update off.
4. `tools/doctools/smoke.sh` converts every fixture with `--network none --read-only --tmpfs /tmp`. It asserts a `%PDF` header and non-empty text, and asserts that the macro fixture's marker file is absent.
5. In `publish-image.yml`, add a `dpf-doctools` entry mirroring `dpf-promoter`: same tags, digest captured into the release manifest, the smoke test, and a size budget that prints the measured size.
6. Add the SBOM entry and a tool-evaluation record (MPL-2.0, separate process).
7. Docs: add a release/install line naming the image.

## S2 · Converter runtime — `feat/document-converter-runtime`, medium

1. **Test first**, `lib/documents/conversion/command.test.ts`: the argv carries every hardening flag, the image is referenced as `name@sha256:`, and the container name is deterministic per job id.
2. `command.ts`: `buildConverterCommand`, a pure function patterned on `buildPromoterCommand`.
3. **Test first**, `convert.test.ts`, with an injected runner (the pattern from `promoter.test.ts`). It covers:
   - success;
   - `input-too-large` rejected before spawning;
   - timeout issues `docker rm -f <name>` and frees the slot;
   - a third concurrent call waits while two run;
   - a non-zero exit returns `conversion-failed`;
   - no docker returns `converter-unavailable`.
4. `convert.ts`: `convertDocument` on `runProcessWithBudget`. If a second domain imports it, move it to a shared module in the same PR, with no behaviour change.
5. `availability.ts`: `getConverterAvailability()` checks `docker version` and `docker image inspect`, caches the result for 60 s, and registers as an `optional` dependency so its absence raises no alert.
6. Resolve `doctoolsImage` wherever `promoterImage` is resolved; never hardcode a tag.
7. Gate: vitest, the build, and a docker-gated `.doc` → PDF test. Docs: a row in `docs/install/platform-support-watchlist.md`.

## S3 · Converter-backed ingestion — `feat/converter-backed-ingestion`, medium

1. Check M5 `BI-0AB1FD47` first. If `parseDocument()` is on `main`, route through it; otherwise route through `parseFileContent`.
2. **Test first.** One routing test per family, using a fake `convertDocument`, covering the format routing table and the `converter-unavailable` → S0 path.
3. Implement the routing with the size caps unchanged, and widen the upload `accept` lists.
4. Gate: vitest and the build. UX verification on the shared nonprod lease: a `.doc` in onboarding capture and an `.xls` in sheet import both produce content, and a plain-language message appears when the converter is off. Docs: the page on supported upload formats.

## S4 · Document renditions — `feat/document-renditions`, medium

1. Migration: add the enum `DocumentRenditionKind (pdf, plain_text)` and cast `renditionKind` with `USING`. Rows that match neither value are removed first; none exist today. Regenerate the union.
2. **Test first**, `lib/documents/renditions.test.ts`:
   - both renditions are written;
   - a rerun is a no-op;
   - a failure records a lifecycle event;
   - the text reaches the full-text and vector paths.
3. `renditions.ts`: a background rendition job triggered from the version save in `document-store.ts` for office MIME types. The MIME list has one home, `conversion/formats.ts`, shared with S3.
4. Full-text search matches `plain_text` rendition text, and `storeDocumentVector` indexes it. `doc_load` returns `renditions`.
5. On the document page, add "View PDF" and "Download original" using shared primitives and `--dpf-*` tokens, after the UX fit review. Add a bounded backfill.
6. Gate: vitest, the build, and the migration applied to a database with and without rows. UX verification, plus a `doc_save` → `doc_search` round trip on the running portal. Docs: the documents guide.

## S5 · Export — `feat/office-export`, medium

1. **Test first.** A markdown fixture (headings, table, list, image) exports to `.docx` and re-imports through S3 intact.
2. Documents go markdown → HTML → `convertDocument` (docx, odt, pdf) and are stored as renditions. This widens `DocumentRenditionKind`, which needs a migration. Add the export action to the document page and `exportFormat` to `doc_load`.
3. **Test first.** A Workbook fixture (formulas, number formats, conditional format, chart view) exports to `.xlsx` and `.ods` and re-imports with the same values.
4. `lib/workbooks/export-fods.ts` is the flat-ODS Workbook writer: model → flat ODS → engine. Once parity holds, delete `components/workbooks/grid-xlsx.ts` and migrate its tests.
5. Gate: vitest, the build, the migration, and UX verification of both controls. Docs: the documents and Workbooks guides.

## S6 · Template-driven generation — `feat/document-generation-engine`, medium

1. `tools/doctools/dpf-render.py`, on `python3-uno`:
   - reads `{ template, content, formats }` JSON on stdin;
   - fills placeholders, master layouts, tables and chart data;
   - writes the office file and PNG previews to stdout as a tar stream.
   Smoke-test it in `publish-image.yml` with a deck, a report and a drawing.
2. **Test first**, `lib/documents/generation/spec.test.ts`. The deck, report, letter, sheet and drawing specs are validated with the platform's existing validator helpers. An invalid spec is rejected with field paths before any container runs.
3. `render.ts`: `renderDocument()` runs on the S2 runtime with a longer timeout. Each call produces an office file + previews, stored as a Document with renditions.
4. `brand-master.ts` builds `.otp`, `.ott` and `.otg` masters from the `Organization` brand, versions them as blobs, and regenerates them when the brand changes.
5. Gate: vitest, the build, a determinism test (the same spec yields the same PDF text and slide count), and a docker-gated render. Docs: an architecture note.

## S7 · Marketing presentations — `feat/marketing-presentations`, medium

1. **Test first.** The `create_presentation` handler maps a coworker outline to a deck spec, and a revision creates a new `DocumentVersion`.
2. Add the tool to the document pack and grant it to the marketing coworker in `packages/db/data/agent_registry.json`.
3. The marketing skill `packages/dpf-skill-pack/skills/create-presentation/SKILL.md` drafts from the playbook and brand, regenerates on feedback, and never edits file XML.
4. Show slide previews on the document page.
5. Gate: vitest, the build, and UX verification: ask the coworker for a 6-slide deck, then open the `.pptx` in Impress. Docs: the marketing guide.

## S8 · EA diagram exchange — `feat/ea-diagram-exchange`, medium

1. **Test first.** The EA view drawing spec carries node positions, sizes and labels, layer colours from resolved `--dpf-*` values, and edges as connectors.
2. EA view export: an action on the view plus an EA-coworker tool, which produce `.odg`, `.svg`, `.pdf` and `.png` through S6.
3. Discovery import review: `.vsd`, `.vsdx` and `.odg` go through the engine to SVG plus shape and connector text. The results become Visio import candidates in the existing EA review flow and are never auto-committed.
4. Gate: vitest, the build, and UX verification. Docs: the EA guide.

## S9 · Retire the in-process parsers — `refactor/retire-in-process-document-parsers`, medium

1. **Check the precondition first.** Converter availability must be true on the source and release compose shapes, and every other watchlist target must have its degraded behaviour recorded. If either fails, stop and record the finding.
2. **Test first.** The existing parser fixtures pass through the engine with the same caps.
3. Route `.docx`, `.xlsx` and `.pdf` behind the same facade, covering all ingestion paths. Remove `mammoth`, `read-excel-file` and `pdf-parse`, and add them to the sbom deny list. Ratchet down `sbom/baseline.json`.
4. Gate: vitest, the build, and `pnpm why` empty for all three. Record the image size change.

## Out of scope (recorded so it is not re-proposed)

- In-browser office editing (Collabora / ONLYOFFICE): rejected under `absorb-dont-adopt`.
- Absorbing Apache OpenOffice.
- The react-pdf invoice, which M5 covers.
- `analyze_brand_document`, which has its own item.
- Warm-process conversion (unoserver) until volume justifies it.
