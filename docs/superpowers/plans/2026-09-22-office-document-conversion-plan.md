---
status: draft
---

# Office document engine: implementation plan

_Umbrella `BI-815D40C6` · Epic `EP-8DC217EB` · Design [2026-09-22-office-document-conversion-design.md](../specs/2026-09-22-office-document-conversion-design.md) · Decision `DI-3638BEF46CE9`._

> **For agentic workers:** one slice = one backlog item, one branch, one PR.
> Claim the slice's BI with its `workShape` before code. Docker-dependent tests
> that could not run are reported as **skipped**, never passed.

## Order and dependencies

```
S0 BI-65D65EC0 ───────────────────────────────┐
S1 BI-15D69168 ── S2 BI-52E565DA ──┬── S3 BI-81524041 ── S9 BI-D1B40D43
                                   ├── S4 BI-9D43CBEF ── S5 BI-4865EB4D
                                   └── S6 BI-3A0E5413 ──┬── S7 BI-543819B1
                                                        └── S8 BI-4C17BF51 (import half needs only S2)
```

S0 and S1 run in parallel. After S2, three lines are independent of each other: ingest (S3, then S9), store (S4, then S5) and produce (S6, then S7 and S8).

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

## S0 · Honest format detection — `BI-65D65EC0`

Branch `fix/office-format-sniffing`. Shape `delivery-small@1.0.0`.

1. **Test first** — `apps/web/lib/shared/file-parsers.test.ts`: add fixtures
   under `apps/web/lib/shared/__fixtures__/office/`. Use real small files for
   `.doc` (OLE), `.rtf` and `.docx`, plus a `.docx` renamed `.doc`. Assert:
   OLE and RTF return `{ unsupported: true, format }`; the renamed file parses;
   RTF control words never appear in `fullText`.
2. Add `sniffOfficeContainer(buffer)` in `file-parsers.ts`: OLE magic, `{\rtf`
   prefix, ZIP header. For ZIP, read the `[Content_Types].xml` / `mimetype`
   entry name to tell OOXML from ODF.
3. Widen `ParsedFileContent` with the unsupported variant. Update the three
   callers to show `reason`:
   - `lib/shared/file-upload.ts`
   - `lib/onboarding/capture-business-document.ts`
   - `lib/workbooks/sheet-import.ts`
4. Gate: affected vitest, then `pnpm --filter web build`. Docs: none
   user-facing yet; the no-docs reason goes in the PR body.

## S1 · `dpf-doctools` image — `BI-15D69168`

Branch `feat/dpf-doctools-image`. Shape `delivery-medium@1.0.0`.

1. `Dockerfile.doctools`:
   - Base: `debian:<current stable>-slim`, pinned by digest.
   - `apt-get install --no-install-recommends libreoffice-core libreoffice-writer libreoffice-calc libreoffice-impress libreoffice-draw python3-uno poppler-utils fonts-dejavu-core fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea`.
   - Remove the apt lists.
   - Create a non-root `doctools` user.
2. `tools/doctools/dpf-convert` (POSIX sh, LF):
   - Read stdin into `/tmp/in.<from>` and enforce `DPF_CONVERT_MAX_BYTES`.
   - Run `soffice --headless --norestore --nolockcheck -env:UserInstallation=file:///tmp/lo --convert-to <filter> --outdir /tmp/out`.
   - Write the result to stdout.
   - Use the exit codes defined in the design.
   - The filter map lives in one table in the script: `pdf`, `docx:"MS Word 2007 XML"`, `xlsx:"Calc MS Excel 2007 XML"`, `txt:"Text (encoded):UTF8"`. Presentations go to text by converting to PDF and extracting the text inside the image with `pdftotext` from `poppler-utils`. `poppler-utils` and `python3-uno` live in the image, not in the portal.
3. `tools/doctools/registrymodifications.xcu`: set macro security to very high, disable macros and linked-content update, and copy it into the baked profile template.
4. `tools/doctools/fixtures/` and `tools/doctools/smoke.sh`:
   - Convert every fixture with `--network none --read-only --tmpfs /tmp`.
   - Assert a non-empty PDF (`%PDF` header) and non-empty text.
   - The macro fixture writes a marker file if it runs; assert the marker is absent.
5. `.github/workflows/publish-image.yml`:
   - Add a `dpf-doctools` matrix entry mirroring `dpf-promoter`: same tags, same digest capture into the release manifest, and the smoke test after the build.
   - Add a size budget step that fails above the budget and prints the measured size.
6. Add an SBOM/allowlist entry and a tool-evaluation record (LibreOffice MPL-2.0, separate process).
7. Gate: build and smoke the image locally or in CI; attach the size to the PR. Docs: add a release/install doc line naming the image.

## S2 · Converter runtime — `BI-52E565DA`

Branch `feat/document-converter-runtime`. Shape `delivery-medium@1.0.0`.

1. **Test first** — `apps/web/lib/documents/conversion/command.test.ts`:
   - The argv contains every hardening flag in the design.
   - The image is `name@sha256:`.
   - The name is deterministic per job id.
2. `command.ts`: `buildConverterCommand`. It is pure and patterned on `buildPromoterCommand`.
3. **Test first** — `convert.test.ts` with an injected process runner (the pattern in `promoter.test.ts`). Cover:
   - success;
   - `input-too-large` rejected before spawn;
   - timeout → `docker rm -f <name>` issued and the slot released;
   - a third concurrent call waits while two run;
   - a non-zero exit maps to `conversion-failed`;
   - a missing docker binary or socket maps to `converter-unavailable`.
4. `convert.ts`: `convertDocument`, built on `runProcessWithBudget` (exported from `lib/self-upgrade/promoter.ts`). If it is imported from a second domain, move it to a shared module first, in the same PR, without changing behaviour.
5. `availability.ts`: `getConverterAvailability()` checks `docker version` and `docker image inspect <ref>`, with a pull on first use when allowed. It caches the answer for 60 s and registers with the existing dependency-health surface as `optional`, so an absent socket is not an alert.
6. Image reference: add `doctoolsImage` wherever `promoterImage` is resolved (release manifest → platform config). Add no hardcoded tag.
7. Docs: add a row to `docs/install/platform-support-watchlist.md`.
8. Gate: affected vitest, the production build, and a docker-gated integration test converting a fixture `.doc` → PDF.

## S3 · Converter-backed ingestion — `BI-81524041`

Branch `feat/converter-backed-ingestion`. Shape `delivery-medium@1.0.0`.

1. Before coding, check M5 `BI-0AB1FD47`. If `parseDocument()` exists on `main`, route there; otherwise route in `parseFileContent`.
2. **Test first**: one routing test per family using a fake `convertDocument`, covering each format → target → existing parser, plus the `converter-unavailable` → S0 result path.
3. Implement the routing table from the design. Keep the size caps unchanged.
4. Widen the `accept` lists in the upload UIs for onboarding capture, Workbooks sheet import and the general upload.
5. Gate:
   - vitest and the production build.
   - UX verification on the running portal (shared nonprod lease): a `.doc` in onboarding capture and a `.xls` in Workbooks import both produce content.
   - Repeat with the converter disabled: the plain-language message appears.
6. Docs: the user guide page on supported upload formats.

## S4 · Document renditions — `BI-9D43CBEF`

Branch `feat/document-renditions`. Shape `delivery-medium@1.0.0`.

1. Migration `…_document_rendition_kind_enum`:
   - Create the enum `DocumentRenditionKind (pdf, plain_text)`.
   - `ALTER COLUMN "renditionKind" TYPE "DocumentRenditionKind" USING (CASE "renditionKind" WHEN 'text' THEN 'plain_text' ELSE "renditionKind" END)::"DocumentRenditionKind"`, and delete any row whose value maps to neither enum value first (none exist today; the guard is for other installs).
   - Regenerate the enum union.
2. **Test first**: `lib/documents/renditions.test.ts` with a fake converter and a mocked Prisma client:
   - Both renditions are written.
   - A second run is a no-op.
   - A failure writes a lifecycle event with the reason.
   - The text rendition reaches the full-text and vector paths.
3. `lib/documents/renditions.ts` and a background function on the current job substrate, triggered from the version-save path in `document-store.ts` when `contentFormat` is an office MIME. The office MIME list is shared with S3; it has one home, in `conversion/formats.ts`.
4. Full-text: extend the search predicate in `document-store.ts` to match `plain_text` rendition text. Semantic: call `storeDocumentVector` with the rendition text.
5. `doc_load` (`lib/mcp/packs/document-pack.ts`) returns `renditions: [{ kind, mimeType, blobId? }]`.
6. UI: add "View PDF" and "Download original" on `app/(shell)/workspace/documents/[documentId]`, built from shared primitives with `--dpf-*` tokens only. Run the UX fit review first.
7. Backfill: a bounded one-time sweep, run by the same function, over existing office blobs.
8. Gate:
   - vitest, the production build, and the migration applied to a copy with and without rows.
   - UX verification of the preview.
   - A `doc_save` → `doc_search` round trip on the running portal.
9. Docs: the documents workspace guide.

## S5 · Export — `BI-4865EB4D`

Branch `feat/office-export`. Shape `delivery-medium@1.0.0`.

1. **Test first (documents).** Export a markdown fixture with headings, a table, a list and an image to `.docx`. Re-import it through S3; the headings and table cells must survive.
2. **Documents.** Render markdown to HTML with the existing renderer, then call `convertDocument` with `to` set to `docx`, `odt` or `pdf`.
   - Store the output as renditions. This widens `DocumentRenditionKind` with `docx` and `odt`, which needs a migration.
   - Add an export control on `app/(shell)/workspace/documents/[documentId]`.
   - `doc_load` gains `exportFormat`.
3. **Test first (Workbooks).** Export a fixture Workbook (formulas, number formats, a conditional format, one chart view) to `.xlsx` and `.ods`. Re-import it through S3; the values must match.
4. **`lib/workbooks/export-fods.ts`.** Write the Workbook model as flat ODS XML (cells, styles, formulas, a chart object), then run it through the engine to get `.xlsx` or `.ods`. Point the Workbooks export button at it.
5. **Remove the old writer.** Once step 3 passes, delete `components/workbooks/grid-xlsx.ts` and migrate its tests.
6. **Gate:** vitest, build, the migration, and UX verification of both controls. Docs: the documents and Workbooks guides.

## S6 · Template-driven generation — `BI-3A0E5413`

Branch `feat/document-generation-engine`. Shape `delivery-medium@1.0.0`.

1. **`tools/doctools/dpf-render.py`.** Runs on the image's `python3-uno` bridge.
   - Reads `{ template, content, formats }` as JSON on stdin and opens the template.
   - Fills named placeholders, master-page layouts, tables and chart data.
   - Exports each requested format plus PNG previews, and writes a tar stream to stdout.
   - `publish-image.yml` smoke-tests it with a fixture deck, report and drawing.
2. **Test first: `lib/documents/generation/spec.test.ts`.** Validate the deck, report, letter, sheet and drawing specs with the platform's existing validator helpers. An invalid spec is rejected with field paths before any container runs.
3. **`lib/documents/generation/render.ts`.** `renderDocument()` runs on the S2 runtime (same hardening, longer timeout) and unpacks the outputs into a Document with renditions (S4), storing previews as blobs.
4. **Brand masters: `lib/documents/generation/brand-master.ts`.** Builds `.otp`, `.ott` and `.otg` masters from the `Organization` brand fields (colours, fonts, logo). They are versioned as DocumentBlobs and regenerated when the brand changes.
5. **Determinism test.** Rendering the same spec twice gives a byte-identical PDF text layer and the same slide count.
6. **Gate:** vitest, build, and a docker-gated end-to-end render. Docs: an architecture note on the generation facility.

## S7 · Marketing presentations — `BI-543819B1`

Branch `feat/marketing-presentations`. Shape `delivery-medium@1.0.0`.

1. **Test first: the `create_presentation` handler.** It maps an outline to a deck spec. Revising an existing presentation creates a new `DocumentVersion`, not a new document.
2. **Tool and grant.** Add the tool to the document pack and grant it to the marketing coworker in `packages/db/data/agent_registry.json`, which is the single source of grants.
3. **Skill: `packages/dpf-skill-pack/skills/create-presentation/SKILL.md`.** The coworker drafts the outline from the organization's marketing playbook and brand, and regenerates on feedback. It never hand-edits file XML.
4. **Slide previews** on the document page, from the S6 previews.
5. **Gate:** vitest, build, and UX verification: on the running portal, ask the marketing coworker for a 6-slide deck and open the `.pptx` in Impress. Docs: the marketing coworker guide.

## S8 · EA diagram exchange — `BI-4C17BF51`

Branch `feat/ea-diagram-exchange`. Shape `delivery-medium@1.0.0`.

1. **Test first: EA view to drawing spec.**
   - Node positions, sizes and labels carry over.
   - ArchiMate layer colours come from `--dpf-*` token values, resolved server-side.
   - Edges become connectors.
2. **Export.** An action on the EA view and a tool for the EA coworker. Through S6 it produces `.odg`, `.svg`, `.pdf` and `.png`.
3. **Import.** A `.vsd`, `.vsdx` or `.odg` file uploaded in discovery goes through the engine, which produces an SVG and extracts the shape and connector text. Those become candidate elements and relationships in the existing EA review flow. They are never committed automatically.
4. **Gate:** vitest, build, and UX verification of export and of the import review. Docs: the EA guide.

## S9 · Retire the in-process parsers — `BI-D1B40D43`

Branch `refactor/retire-in-process-document-parsers`. Shape `delivery-medium@1.0.0`.

1. **Check the precondition before starting.** `getConverterAvailability()` must be true on both the source and the release compose install shapes. Every other target in `docs/install/platform-support-watchlist.md` must have its degraded behaviour recorded. If either condition fails, stop and record the finding on the backlog item.
2. **Test first.** The existing parser fixtures pass through the engine path, with the same caps:
   - `.docx`: headings preserved;
   - `.xlsx`: columns and sample rows;
   - `.pdf`: text.
3. **Route through the engine.** Send `.docx`, `.xlsx` and `.pdf` through the engine behind the same facade, and delete the bodies of `parseDocx`, `parseXlsx` and `parsePdf`.
4. **Remove the packages.** Drop `mammoth`, `read-excel-file` and `pdf-parse` from `apps/web` and `packages/db`. Add them to the deny list in `sbom/dependency-allowlist.json`, and ratchet `sbom/baseline.json` down.
5. **Gate:**
   - vitest and build;
   - `pnpm why` returns nothing for the three packages;
   - the PR records the change in image size.

## Out of scope (recorded so it is not re-proposed)

- **In-browser office editing** (Collabora Online / ONLYOFFICE). Rejected under `absorb-dont-adopt`. People edit in their own office suite and upload a new version.
- **Absorbing Apache OpenOffice.**
- **The react-pdf invoice.** M5 covers it.
- **`analyze_brand_document`.** It is a stub with its own backlog item.
- **Warm-process conversion (unoserver).** Out of scope until measured volume makes cold starts a problem.
