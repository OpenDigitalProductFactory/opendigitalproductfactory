---
status: draft
---

# Office document conversion: a one-shot converter, not an office suite

**BI:** `BI-815D40C6` (umbrella) · slices `BI-65D65EC0`, `BI-15D69168`, `BI-52E565DA`, `BI-81524041`, `BI-9D43CBEF`
**Epic:** `EP-8DC217EB` (Vertical Integration Inward)
**Decision:** `DI-3638BEF46CE9` (`principle_decide`, platform-development, confidence high)
**Base:** `main` at `0d80ac222a1`
**Related:** [dependency diet plan](../plans/2026-09-08-dependency-diet-and-vertical-integration-plan.md) M2 (`BI-DBDB8C6D`), M3 (`BI-068BBA33`), M5 (`BI-0AB1FD47`); the speech-sidecar removal precedent (PR #5290, `BI-F7E9A541`)
**Plan:** [2026-09-22-office-document-conversion-plan.md](../plans/2026-09-22-office-document-conversion-plan.md)

## Problem and scope

The founder asked (2026-09-22) to evaluate Apache OpenOffice and absorb what
makes sense into DPF. An office suite has three parts: editors (word
processor, spreadsheet, presentations), file-format filters, and a headless
converter. DPF already owns a spreadsheet surface (Workbooks, with its own
formula engine and `.xlsx` writer) and stores documents as markdown. It has
no need for desktop editors. What it lacks is the filter and converter layer.

Verified on `main` at `0d80ac222a1`:

1. `apps/web/lib/shared/file-parsers.ts` sends `.doc` and
   `application/msword` to mammoth, which reads only OOXML. A real Word
   97-2003 file is an OLE compound file, so the parse fails. `.rtf` is on the
   plain-text list, so RTF control words are stored and embedded as content.
2. Nothing reads `.ppt`, `.pptx`, `.odt`, `.ods` or `.odp`.
3. `DocumentRendition` (`packages/db/prisma/schema/knowledge-docs.prisma`)
   has no writer anywhere in `apps/web`.
4. `document-store.ts` sets `fullTextIndexedAt` and stores a vector only when
   a version carries `contentText`. An office file saved as a `DocumentBlob`
   through `doc_save` is invisible to `doc_search` and to semantic search.

In scope: a converter image, a sandboxed runtime that launches it, converter-
backed ingestion, and document renditions with indexing. Out of scope:
in-browser office editing, presentation authoring, any change to Workbooks'
own model, the react-pdf invoice (M5 owns it), and the `analyze_brand_document`
stub.

## Objectives

- **OBJ-ODC-HONEST:** No office format is silently mis-parsed. A file DPF
  cannot read yields a typed, plain-language unsupported result.
- **OBJ-ODC-INGEST:** Legacy Word/Excel/PowerPoint, RTF, PPTX and ODF files
  are read by every ingestion path (uploads, onboarding capture, Workbooks
  sheet import) through the parsers DPF already has.
- **OBJ-ODC-RENDITION:** An office file in the document store has a PDF and a
  plain-text rendition, and its text is found by full-text and semantic search.
- **OBJ-ODC-FOOTPRINT:** The capability adds no always-on container, nothing
  to any compose file, and nothing to the portal image.
- **OBJ-ODC-CONTAIN:** Untrusted documents are converted with no network, no
  macro execution, a read-only filesystem, and bounded memory, time and
  concurrency.

## Design (ordered deliverables)

Implementation detail, file paths and test lists live in the plan.

- **S0 · Honest format detection (`BI-65D65EC0`, ships first).** `parseFileContent` sniffs content before trusting the extension (OLE magic `D0 CF 11 E0`, `{\rtf`, ZIP header). Legacy binary, RTF and not-yet-convertible formats return a typed unsupported result with a plain-language reason; a `.docx` misnamed `.doc` still parses. Every later slice degrades to this.
- **S1 · `dpf-doctools` image (`BI-15D69168`).** A DPF-built, Debian-slim image with the distribution's LibreOffice writer/calc/impress (no Java, Base or GUI) and metric-compatible fonts. A non-root `dpf-convert --to <pdf|docx|xlsx|txt>` entrypoint reads stdin and writes stdout, with fixed exit codes. The baked profile disables macros and linked-content loading. `publish-image.yml` publishes it beside `dpf-promoter` with a recorded digest and a size budget. It is **not** in any compose file or profile: PR #5290 removed the only optional third-party image because `verify-compose-image-manifests` checks every profile and froze `promote-latest`.
- **S2 · Converter runtime (`BI-52E565DA`).** `apps/web/lib/documents/conversion/` follows the promoter precedent: the portal already mounts the docker socket and launches `dpf-promoter` one-shot (`buildPromoterCommand`, `runProcessWithBudget`). `convertDocument()` runs `docker run --rm -i --network none --read-only` with tmpfs, memory, pid and capability limits, streams stdin/stdout (no bind mounts, so install shapes never differ), and caps input size, wall-clock time and concurrency. It returns a typed result and never throws on expected failure (`converter-unavailable`, `input-too-large`, `timeout`, `conversion-failed`). An install with no docker socket reports "unavailable by design", not an outage. The image reference comes from the same channel as `promoterImage`.
- **S3 · Converter-backed ingestion (`BI-81524041`).** Conversion normalises to formats existing parsers read, so no parser library is added: `.doc/.rtf/.odt` → `.docx` → `parseDocx`; `.xls/.ods` → `.xlsx` → `parseXlsx`; `.ppt/.pptx/.odp` → text. It routes behind M5's `parseDocument()` if that has landed, else `parseFileContent`. Uploads, onboarding capture and Workbooks sheet import widen their accepted types together.
- **S4 · Document renditions (`BI-9D43CBEF`).** `renditionKind` becomes the Prisma enum `DocumentRenditionKind { pdf, plain_text }` (AGENTS.md §8). A durable background function converts office versions to PDF (a `DocumentBlob`) and text, writes both renditions idempotently on the existing unique key, and indexes the text through the existing full-text and `storeDocumentVector` paths. Failures become `DocumentLifecycleEvent`s with the typed reason. `doc_load` returns renditions; the document page offers "View PDF" and "Download original". A bounded backfill covers existing office blobs.

## Research and benchmarking

| Candidate | What it is | Verdict |
|---|---|---|
| **Apache OpenOffice** | 4.1.16 (2025-11-10); the site says it is "developed 100% by volunteers". Apache-2.0. | **Rejected.** Few releases, and weaker OOXML fidelity than its fork. It is ~10 M lines of C++ desktop suite, so there is nothing to merge into a TypeScript platform, and its only usable surface (headless conversion) is better served by LibreOffice. |
| **LibreOffice headless** | The actively developed fork. `soffice --headless --convert-to`. MPL-2.0. | **Adopted** as the engine inside `dpf-doctools`. It runs as a separate process with no linking, so the licence imposes nothing on DPF source. |
| **Gotenberg** | A Docker HTTP API that bundles LibreOffice and Chromium for conversion to PDF. | **Rejected.** It is an always-on service, which conflicts with the dependency diet's removal of always-on containers. The browser half duplicates the `browser-use` sidecar that M5 already plans to print PDFs through. It would also be a third-party pinned image in Compose (the PR #5290 failure mode). |
| **unoserver** | A persistent LibreOffice listener plus a client. MIT. It replaces the deprecated unoconv. Its project states 2-4× throughput from keeping one warm process. | **Deferred.** It is worth adopting inside `dpf-doctools` only if measured conversion volume makes cold starts a problem. The one-shot contract does not change if it is adopted. |
| **Collabora Online / ONLYOFFICE Docs** | In-browser collaborative office editing servers. | **Rejected.** They are large, always-on, stateful services, and nothing in the backlog asks for office editing. DPF's documents are markdown, and its spreadsheet is Workbooks. |
| **Hosted conversion API** | Rented conversion as a service. | **Rejected** as a default. Organisation documents would leave the install, and it scored lowest on operational independence and data privacy. An operator could add it later behind the same `convertDocument` contract. |

The kernel decision (`DI-3638BEF46CE9`) scored the one-shot LibreOffice image at
9.50, the always-on Gotenberg service at 5.28, the hosted API at 4.51 and
absorbing Apache OpenOffice at 3.59, with a margin of 4.22 and no sensitivity
flips.

**Architecture grounding.** This design adds no new substrate beyond one
enum. The rendition slot (`DocumentRendition`), the blob store
(`DocumentBlob`), the lifecycle ledger (`DocumentLifecycleEvent`), the vector
path (`storeDocumentVector`), the one-shot container pattern (promoter), the
process budget (`runProcessWithBudget`) and the parsers already exist. The
`dpf-doctools` name is the tool image the dependency diet's M2 already
proposed. M2 used the upstream mermaid image instead, so the name is free.

## Security

Documents are untrusted input to a large C++ parser, and LibreOffice has had advisories for macro execution and linked-content loading. Containment rests on the container, not on the parser: no network, read-only root, no host mounts (stdin/stdout only), all capabilities dropped, `no-new-privileges`, non-root, memory/pid limits, a wall-clock kill, and macros disabled in the baked profile. The image rebuilds each release, so distribution security fixes ship with the platform and the release SBOM/OSV scanning covers it.

## Acceptance

| Acceptance ID | Objective IDs | Required outcome |
|---|---|---|
| AC-ODC-001 | OBJ-ODC-HONEST | A real `.doc` (OLE) and a real `.rtf` never reach mammoth or the text path; each returns the typed unsupported result, and a `.docx` renamed `.doc` still parses. |
| AC-ODC-002 | OBJ-ODC-CONTAIN | The built image converts `.doc/.xls/.ppt/.rtf/.odt/.pptx` fixtures to PDF and text under `--network none --read-only`, and a fixture's auto-run macro does not execute. |
| AC-ODC-003 | OBJ-ODC-FOOTPRINT | No compose file, compose profile or portal Dockerfile stage references `dpf-doctools` or LibreOffice; the image is published by `publish-image.yml` with a recorded digest and size. |
| AC-ODC-004 | OBJ-ODC-CONTAIN | The argv builder emits every hardening flag and a digest-pinned image; a hung conversion is removed by name within the timeout and its concurrency slot is released. |
| AC-ODC-005 | OBJ-ODC-INGEST | On the running portal, a `.doc` uploaded during onboarding capture and a `.xls` imported into Workbooks both produce content; with the converter unavailable, both show the plain-language unsupported message. |
| AC-ODC-006 | OBJ-ODC-RENDITION | A `.docx` and a `.pptx` saved through `doc_save` get `pdf` and `plain_text` renditions; `doc_search` finds a phrase from the body and semantic search returns the document. |
| AC-ODC-007 | OBJ-ODC-RENDITION, OBJ-ODC-HONEST | With the converter unavailable, saving an office file records a `converter-unavailable` lifecycle event and the document still loads. |
| AC-ODC-008 | OBJ-ODC-RENDITION | The `renditionKind` enum migration applies cleanly to a database with and without rendition rows. |

## Verification

Each slice runs the build gate for its own change (AGENTS.md §4): unit tests,
the production build, UX verification for S3 and S4, and a migration check
for S4. The docker-dependent tests are gated on docker availability. When
docker is absent they are reported as skipped, never passed. The image
smoke test runs in the publishing workflow.

## Documentation impact

S1 release/install docs; S2 a `platform-support-watchlist.md` row; S3 supported upload formats in the user guide; S4 the documents workspace guide.
