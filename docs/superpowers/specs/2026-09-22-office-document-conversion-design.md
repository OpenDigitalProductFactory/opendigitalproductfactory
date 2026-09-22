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

### S0 · Honest format detection (`BI-65D65EC0`, small, ships first)

`parseFileContent` sniffs content before trusting the extension:
OLE compound-file magic `D0 CF 11 E0 A1 B1 1A E1` means a legacy binary office
file, `{\rtf` means RTF, `PK\x03\x04` means OOXML or ODF. Legacy binary and RTF
return `{ unsupported: true, format: 'legacy-word' | 'legacy-excel' |
'legacy-powerpoint' | 'rtf' | 'presentation' | 'odf', reason }`. A `.docx`
misnamed `.doc` still parses. Callers show the reason in plain language. This
is also the fallback every later slice degrades to.

### S1 · `dpf-doctools` image (`BI-15D69168`)

`Dockerfile.doctools`: Debian-slim, the distribution's `libreoffice-core`,
`-writer`, `-calc` and `-impress` (no Java, no Base, no GUI), and a bounded
font set with metric-compatible substitutes for the common Office fonts so page
layout survives conversion. A non-root user runs the `dpf-convert` entrypoint:

```
dpf-convert --to <pdf|docx|xlsx|txt> [--from <ext>]   # stdin → stdout
exit 0 ok · 2 bad args · 3 conversion failed · 4 input too large · 124 timeout
```

The LibreOffice user profile is baked read-only with macro security at its
highest level, macro execution off and linked/remote content loading off.

The image is built and published by `publish-image.yml` beside `dpf-promoter`,
tagged with the release, and its digest recorded in the release manifest. It is
**not** added to any compose file or profile. PR #5290 removed the only
optional third-party image from Compose because `verify-compose-image-manifests`
checks every profile, so an optional service nobody ran still froze
`promote-latest`. A DPF-built image published with the release does not share
that failure mode. CI asserts an image-size budget and records the measured
size.

### S2 · Converter runtime (`BI-52E565DA`)

`apps/web/lib/documents/conversion/` follows the promoter precedent: the portal
already mounts the docker socket and launches the DPF-built `dpf-promoter` image
one-shot (`apps/web/lib/self-upgrade/promoter.ts`, `buildPromoterCommand`).

- `buildConverterCommand` is a pure argv builder: `docker run --rm -i
  --network none --read-only --tmpfs /tmp:size=512m --memory 1g
  --pids-limit 256 --cap-drop ALL --security-opt no-new-privileges --user
  <uid> --name dpf-doctools-<id> <image@digest> dpf-convert --to <fmt>`.
- `convertDocument({ input, from, to })` spawns through the existing
  `runProcessWithBudget` and streams stdin and stdout. There are no bind mounts,
  so the host-path and named-volume differences between the source install and
  the release install never matter. It enforces an input cap (50 MB default),
  a wall-clock timeout (120 s, then `docker rm -f` by name) and a process-wide
  concurrency cap (2).
- It returns `{ ok: true, bytes, mime }` or `{ ok: false, reason:
  'converter-unavailable' | 'input-too-large' | 'timeout' |
  'conversion-failed' }`. Expected failures never throw.
- `getConverterAvailability()` reports whether the socket is reachable and the
  image present or pullable. An install without a docker socket reports
  "unavailable by design", not an outage (the `dpf-stt` probe in PR #5290
  published a permanent 0 for a dependency never deployed).
- The image reference comes from the same release-manifest and platform-config
  channel as `promoterImage`. It is never hardcoded.

### S3 · Converter-backed ingestion (`BI-81524041`)

Conversion normalises to a format an existing parser already reads, so no new
parsing library enters the tree:

| Input | Converted to | Parsed by |
|---|---|---|
| `.doc`, `.rtf`, `.odt` | `.docx` | `parseDocx` (mammoth, keeps headings) |
| `.xls`, `.ods` | `.xlsx` | `parseXlsx` (read-excel-file) |
| `.ppt`, `.pptx`, `.odp` | text | plain-text path |

When M5's `parseDocument()` facade exists, the routing lives behind it;
otherwise it goes into `parseFileContent` and M5 inherits it. The three callers
(`file-upload.ts`, `onboarding/capture-business-document.ts`,
`workbooks/sheet-import.ts`) and their upload `accept` lists widen together.
When conversion is unavailable, the S0 result is returned.

### S4 · Document renditions (`BI-9D43CBEF`)

- Migration: `DocumentRendition.renditionKind` changes from `String` to the
  Prisma enum `DocumentRenditionKind { pdf, plain_text }` (AGENTS.md §8). The
  table has no rows today; the migration still casts safely for any data state.
- A durable background function on the current job substrate (it moves with
  M3 if M3 lands first) runs when a version with an office `contentFormat` is
  saved. It converts the file to PDF and to text, writes both renditions (the
  PDF as a `DocumentBlob`; the text inline up to
  `DOCUMENT_TEXT_INLINE_LIMIT_BYTES`), then indexes the text through the
  existing full-text and `storeDocumentVector` paths. It is idempotent on the
  existing `(documentVersionId, renditionKind)` unique key.
- A failure is written as a `DocumentLifecycleEvent` with its typed reason. A
  document that cannot be converted is visible rather than silently unindexed.
  Once the converter becomes available again, `converter-unavailable` is retried
  one time. It is not retried on a timer.
- `doc_load` returns the available renditions. The document page offers "View
  PDF" and "Download original", built from shared UI primitives and `--dpf-*`
  tokens.
- A bounded one-time backfill covers office blobs that already exist.

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

A document is untrusted input to a large C++ parser. LibreOffice has had
advisories in exactly this class, including macro execution and the loading of
linked or remote content. The containment rests on the container, not on
LibreOffice being bug-free:

- There is no network, so linked content cannot be fetched and nothing can leave.
- The root filesystem is read-only, with a size-capped tmpfs.
- All capabilities are dropped and `no-new-privileges` is set.
- It runs as a non-root user.
- Memory and pid limits apply, plus a wall-clock kill.
- No host path is mounted; the only I/O is stdin and stdout.
- Macros are disabled in the baked profile.

The image rebuilds with each release, so distribution security updates travel
with the platform version. The OSV/SBOM posture covers the image through the
same release scanning as `dpf-promoter`.

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

- S1: release/install docs name the new published image.
- S2: `docs/install/platform-support-watchlist.md` gets a row (targets with no
  docker socket report the converter as unavailable by design).
- S3: the user guide section on supported upload formats.
- S4: the documents workspace guide (renditions and preview).
