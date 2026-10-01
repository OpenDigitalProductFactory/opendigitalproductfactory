---
status: draft
---

# Office document engine: absorb the LibreOffice engine, not an office suite

**BI:** `BI-815D40C6` (umbrella) · S0 `BI-65D65EC0` · S1 `BI-15D69168` · S2 `BI-52E565DA` · S3 `BI-81524041` · S4 `BI-9D43CBEF` · S5 `BI-4865EB4D` · S6 `BI-3A0E5413` · S7 `BI-543819B1` · S8 `BI-4C17BF51` · S9 `BI-D1B40D43` · follow-up `BI-BFF142A1`
**Epic:** `EP-8DC217EB` · **Decision:** `DI-3638BEF46CE9` · **Doctrine:** `absorb-dont-adopt` (commandment, `BI-1637FC89`)
**Plan:** [2026-09-22-office-document-conversion-plan.md](../plans/2026-09-22-office-document-conversion-plan.md)

## Problem and scope

The founder asked (2026-09-22) to absorb what Apache OpenOffice offers. The concern behind it: DPF's internal document tools (Workbooks, documents, presentations, EA drawings) lack office-suite fidelity and breadth. The direction is absorption, with fewer dependencies.

Verified on `main` at `0d80ac222a1`:
- `file-parsers.ts` sends legacy `.doc` to mammoth, which reads `.docx` only. `.rtf` is ingested as raw markup. Nothing reads `.ppt`, `.pptx`, `.odt`, `.ods` or `.odp`.
- `DocumentRendition` has no writer, so office blobs are never full-text or vector indexed.
- Workbooks export through a hand-written `.xlsx` writer that carries data only, with no formats or charts.
- Documents are read-only markdown with no export.
- No coworker can produce a presentation.
- The EA canvas has no drawing exchange.
- Parsing rents three packages (mammoth, read-excel-file, pdf-parse); pdf-parse brings about 56 MB of transitive weight.

In scope: one engine that both reads and produces office files. Out of scope: in-browser office editing, replacing Workbooks' data model, and the EA model itself.

## Objectives

- **OBJ-ODC-HONEST:** No office format is silently mis-parsed. An unreadable file yields a typed, plain-language result.
- **OBJ-ODC-INGEST:** Every ingestion path reads legacy Office, RTF, PPTX and ODF files.
- **OBJ-ODC-RENDITION:** Office files in the document store have PDF and text renditions and are searchable.
- **OBJ-ODC-PRODUCE:** Documents, Workbooks, presentations and EA views are produced as full-fidelity office files from one shared facility.
- **OBJ-ODC-FOOTPRINT:** No always-on container, nothing added to the portal image, and the net dependency count falls.
- **OBJ-ODC-CONTAIN:** Untrusted documents convert with no network, no macros, a read-only filesystem and bounded resources.

## Design

Applying the absorption ladder (`absorb-dont-adopt`): about 10 million lines of C++ cannot be absorbed as source. The next rung is infrastructure DPF owns: a DPF-built, pinned tool image that runs one-shot, never always-on. Callers reach it only through platform contracts, and it retires the packages it duplicates.

- **S0 · Honest detection.** Sniff content (OLE, `{\rtf`, ZIP) before trusting the extension. Legacy binary formats and RTF get a typed unsupported result, and every later slice degrades to it.
- **S1 · `dpf-doctools` image.** Debian-slim with the distribution's LibreOffice writer, calc, impress and draw, metric-compatible fonts, `python3-uno` and `pdftotext`. It runs as a non-root user.
  - `dpf-convert` reads stdin and writes stdout, with fixed exit codes. `dpf-render` serves S6.
  - The baked profile disables macros and linked content.
  - `publish-image.yml` publishes it beside `dpf-promoter`, with a recorded digest and a size budget.
  - It is not in Compose: PR #5290 showed that an optional image there freezes `promote-latest`.
- **S2 · Runtime.** `convertDocument()` follows the promoter precedent: the portal already mounts the docker socket and runs `runProcessWithBudget`.
  - It runs `docker run --rm -i --network none --read-only` with tmpfs, memory, pid and capability limits, over stdin and stdout only.
  - It caps input size, run time and concurrency.
  - It returns a typed result and never throws on an expected failure.
  - An install without a docker socket reports "unavailable by design".
- **S3 · Ingestion.** Convert to what an existing parser reads: `.doc`, `.rtf` and `.odt` to `.docx`; `.xls` and `.ods` to `.xlsx`; slides to text. This applies to uploads, onboarding capture and Workbooks import.
- **S4 · Renditions.** `renditionKind` becomes a Prisma enum. A durable job writes PDF and text renditions and indexes the text. Failures are recorded as `DocumentLifecycleEvent`s. The document page shows the PDF.
- **S5 · Export.** Documents export to `.docx`, `.odt` and `.pdf`. Workbooks export to `.xlsx` and `.ods` with formats and charts, generated as flat ODS through the engine. This retires the hand-written `grid-xlsx.ts`.
- **S6 · Generation.** `renderDocument(templateRef, content, formats)`:
  - A Python-UNO script, using the image's `python3-uno` bridge so nothing is added to the portal, fills a template from a validated JSON content spec (deck, report, letter, sheet, drawing).
  - It exports the office file plus PNG previews.
  - Brand masters derive from `Organization`, the canonical identity.
  - The output is a Document with renditions.
  - The model writes a spec, never raw file XML.
- **S7 · Presentations.** The marketing coworker gets a `create_presentation` tool and a skill. An outline becomes a branded `.pptx`, a PDF and slide previews. A revision creates a new version, not a new document.
- **S8 · EA exchange.** An EA view exports to `.odg`, `.svg` and `.pdf`. Customer Visio or `.odg` files import as candidate elements for review, never auto-committed. The canvas stays model-first.
- **S9 · Retire parsers.** Once S3 is proven on every install shape, `.docx`, `.xlsx` and `.pdf` also route through the engine, and mammoth, read-excel-file and pdf-parse are removed and added to the deny list. If any deployment target cannot run the engine, that is recorded as a finding and the parsers stay.

People edit office files in their own office suite: download, edit, then upload a new version, which S4 indexes. A rented in-browser editor is rejected under the doctrine.

### Follow-up: charts through the trusted renderer path (`BI-BFF142A1`)

**Defect, reproduced on `c9fd3d7c126` (main, 2026-09-25).** The baked profile's `DisableActiveContent` (`tools/doctools/registrymodifications.xcu` line 23) makes the engine refuse any ODF file that embeds an object, and a chart is an embedded object. Built from that commit, `dpf-convert --to xlsx --from fods` exits 3 ("source file could not be loaded") for a flat ODS carrying one bar chart, and exits 0 for the same file without it. So S5 shipped the Workbook chart view only as a "Chart data" sheet (`apps/web/lib/workbooks/export-fods.ts` lines 251-258), and a customer `.ods`/`.odt` with a chart fails ingestion and renditions as a generic conversion failure.

**Causes ruled out by running them.** In a per-run copy of the profile, relaxing only `DisableOLEAutomation` or only `BlockUntrustedRefererLinks` still exits 3. Relaxing only `DisableActiveContent` exits 0 and the `.xlsx` carries `xl/charts/chart1.xml`.

**Founder decision (2026-09-25): trusted path only.** `dpf-convert` stays fully hardened for customer files. Only `dpf-render`, in its per-run profile copy, relaxes `DisableActiveContent`, and only for documents DPF generated and screened.

**Deliverables, in order:**
1. `dpf-render` gains a document mode: it takes a DPF-generated flat ODS or ODT, screens it (no scripts, event bindings, DDE, applets, plugins, OLE objects or external links; embedded objects only as inline chart sub-documents that pass the same screen), and exports it. `renderFlatDocument` (`apps/web/lib/documents/generation/render-flat.ts`) is the portal side.
2. The Workbook export writes the bar chart object again (the "Chart data" sheet stays) and routes through that mode, so the chart appears in the `.xlsx` and `.ods` (AC-1, docker-gated test).
3. `dpf-convert` is unchanged. The contract test still asserts `DisableActiveContent` is on, and `smoke.sh` proves the converter refuses the chart fixture that the renderer exports (AC-2).
4. When the converter refuses an OpenDocument file, S3 ingestion and S4 renditions check deterministically whether it embeds objects: the package's `META-INF/manifest.xml`, or the object elements of a flat document. If it does, the person gets a plain-language "contains embedded objects (such as charts) that DPF does not open" result (reason `embedded-objects` for renditions), not a generic conversion failure (AC-3). The check runs only after a refusal, never before conversion. Measured while delivering this: a zipped `.ods`/`.odt` with a chart still converts through the hardened converter. Its text is read, the PDF shows the chart's stored picture, and `.docx`/`.xlsx` drop it. Only a flat ODS with an inline chart is refused. A check before conversion would have refused files that convert today.
5. The macro probe runs against the render profile too, so macros are proven off on both paths.
6. The LibreOffice tool evaluation and the document generation facility doc record the decision.

## Research and benchmarking

| Candidate | Verdict |
|---|---|
| **Apache OpenOffice** 4.1.16 (2025-11), "developed 100% by volunteers", Apache-2.0 | **Rejected.** Weaker OOXML fidelity and few releases. Its only usable surface, the headless engine, is better served by its fork. |
| **LibreOffice** headless + UNO, MPL-2.0 | **Adopted** as the engine. It runs as a separate process, so its licence imposes nothing on DPF source. |
| **Gotenberg** (LibreOffice + Chromium HTTP API) | **Rejected.** Always-on, and its browser duplicates the `browser-use` sidecar. |
| **unoserver** (warm listener, MIT, 2–4× throughput claimed) | **Deferred** until measured volume justifies a warm process. The contract is unchanged either way. |
| **Collabora Online / ONLYOFFICE** (in-browser editing) | **Rejected.** Collabora's free CODE edition is "not recommended for production", so this means a paid subscription or an always-on AGPL service. That is adopting, not absorbing. |
| **Hosted conversion API** | **Rejected.** Documents would leave the install; it ranks lowest on independence. |

`DI-3638BEF46CE9` scored the one-shot engine at 9.50, Gotenberg at 5.28, a hosted API at 4.51 and absorbing OpenOffice at 3.59. The golden scenario `adopt-vs-absorb-capability` (`BI-1637FC89`) now locks this direction.

## Security

LibreOffice has had advisories about macros and linked content, so containment rests on the container, not the parser: no network, a read-only root, no host mounts, all capabilities dropped, `no-new-privileges`, a non-root user, memory and pid limits, a timeout kill, and macros off. The image is rebuilt every release and covered by the release SBOM and OSV scanning.

## Acceptance

| Acceptance ID | Objective IDs | Required outcome |
|---|---|---|
| AC-ODC-001 | OBJ-ODC-HONEST | A real `.doc` or `.rtf` never reaches mammoth or the text path; a `.docx` renamed `.doc` still parses. |
| AC-ODC-002 | OBJ-ODC-CONTAIN | The image converts `.doc/.xls/.ppt/.rtf/.odt/.pptx` fixtures offline and read-only; a macro fixture does not execute. |
| AC-ODC-003 | OBJ-ODC-FOOTPRINT | No compose file or portal build stage references the engine; the image is published with a recorded digest and size. |
| AC-ODC-004 | OBJ-ODC-CONTAIN | The runtime emits every hardening flag and a digest-pinned image; a hung job is killed and its slot freed. |
| AC-ODC-005 | OBJ-ODC-INGEST | On the running portal, a `.doc` in onboarding and an `.xls` in Workbooks produce content; with no converter, a plain-language message appears instead. |
| AC-ODC-006 | OBJ-ODC-RENDITION | A `.docx` and a `.pptx` saved with `doc_save` get renditions; `doc_search` and semantic search find their body text. |
| AC-ODC-007 | OBJ-ODC-RENDITION, OBJ-ODC-HONEST | With no converter, saving records `converter-unavailable` and the document still loads. |
| AC-ODC-008 | OBJ-ODC-PRODUCE | A document exports to `.docx`; a Workbook with formats and a chart exports to `.xlsx/.ods` and re-imports to the same values. |
| AC-ODC-009 | OBJ-ODC-PRODUCE | The marketing coworker produces a branded `.pptx`, a PDF and previews on the running portal. |
| AC-ODC-010 | OBJ-ODC-PRODUCE | An EA view exports to `.odg/.svg/.pdf`; a Visio fixture yields reviewable candidate elements. |
| AC-ODC-011 | OBJ-ODC-FOOTPRINT | After S9, mammoth, read-excel-file and pdf-parse are absent from the lockfile and on the deny list, and the SBOM baseline ratchets down. |

## Verification and documentation

Each slice runs its own build gate (AGENTS.md §4):
- UX verification for S3, S4, S5, S7 and S8.
- A migration check for S4.
- Tests that need docker report "skipped", never "passed", when docker is absent.

Each slice updates its own docs: install, platform-support watchlist, user guide, and the documents and EA guides.
