# Tool Evaluation: LibreOffice headless (dpf-doctools image)

**Backlog item:** `BI-15D69168` (slice S1 of `BI-815D40C6`)
**Decision:** conditional approval
**Risk:** medium
**Confidence:** 0.85
**Re-evaluate after:** 2027-03-24, on any Debian base or LibreOffice major-version change, or immediately after a LibreOffice security advisory about document loading, macros or linked content

The office document engine absorbs LibreOffice's headless converter as a
DPF-built image, `dpf-doctools`, instead of adopting an office suite or a hosted
conversion API. Governed decision `DI-3638BEF46CE9` scored this option 9.50,
against Gotenberg at 5.28, a hosted API at 4.51 and absorbing Apache OpenOffice
at 3.59. The design is
[2026-09-22-office-document-conversion-design.md](../../superpowers/specs/2026-09-22-office-document-conversion-design.md).

What is evaluated is the image built by `Dockerfile.doctools`:

- `debian:trixie-slim`, pinned by digest;
- Debian's `libreoffice-{core,writer,calc,impress,draw}-nogui` packages
  (LibreOffice 25.2.3 when measured);
- `python3-uno`, `poppler-utils`, and the DejaVu, Liberation, Carlito and
  Caladea fonts;
- the entry point `tools/doctools/dpf-convert` and the hardened profile
  `tools/doctools/registrymodifications.xcu`.

It is not a compose service and never runs always-on.

## CoSAI security findings

| # | Category | Severity | Finding | Required treatment |
| --- | --- | --- | --- | --- |
| 1 | Input validation | high | LibreOffice parses complex, untrusted binary formats (.doc, .xls, .ppt, .rtf). Parser defects are its main advisory class. | Containment rests on the container, not the parser: no network, a read-only root, no host mounts, all capabilities dropped, `no-new-privileges`, a non-root user, memory and pid limits, and a timeout kill. The runtime (S2) must emit every one of these flags. |
| 2 | Code execution | high | Documents can carry Basic macros bound to load, save and view events. | The baked profile sets macro security to very high (3), turns macro execution off, and leaves the trusted-location list empty. `smoke.sh` proves a live auto-run macro fixture runs under a permissive profile and does not run under the hardened profile, even when the caller asks for `ALWAYS_EXECUTE_NO_WARN`, or through `dpf-convert`. |
| 3 | Linked content | high | Linked documents, OLE and DDE can fetch or read resources beyond the input (the linked-document advisory class). | `DisableActiveContent`, `DisableOLEAutomation` and `BlockUntrustedRefererLinks` are on, and link update on load is set to never for Writer and Calc. The runner also removes the network. |
| 4 | Data/control boundary | low | The engine receives document bytes only; it never receives prompts, credentials or tenant context. | stdin in, stdout out, and diagnostics on stderr. No arguments carry content. |
| 5 | Resource management | medium | A crafted document can consume unbounded CPU or memory while it is laid out. | `DPF_CONVERT_MAX_BYTES` refuses oversized input before the engine starts (exit 4). `DPF_CONVERT_TIMEOUT_SECONDS` kills the run (exit 124). The container carries memory and pid limits. |
| 6 | State isolation | low | A LibreOffice profile persists settings and could carry a weakened configuration between runs. | Each run copies the read-only template into a fresh profile under the `/tmp` tmpfs and removes it on exit. |
| 7 | Integrity controls | low | The image is built by DPF from distribution packages. | The base image is pinned by digest. The image is published per release as a multi-arch manifest list whose digest is recorded by the merge job, with provenance and a BuildKit SBOM attestation. Callers pin `dpf-doctools@sha256:`. |
| 8 | Supply chain | medium | LibreOffice ships frequent security fixes; a pinned base can age. | The image is rebuilt on every release, so it takes Debian security updates. The base digest is bumped deliberately. `smoke.sh` and the size budget gate every rebuild. |
| 9 | Network isolation | low | The engine needs no network. | The runner uses `--network none` and the smoke test runs every conversion that way. |
| 10 | Operational security | low | A failed conversion must not look like an empty document. | The exit codes are fixed and documented (0, 2, 3, 4, 124), and stdout carries only the converted file. |

## Compliance and architecture fit

- **Licences:**
  - LibreOffice is MPL-2.0; some parts are under LGPLv3+ or Apache-2.0.
  - `python3-uno` is MPL-2.0.
  - `poppler-utils` is GPL-2.0/GPL-3.0.
  - The fonts are under SIL OFL-1.1 (Liberation, Carlito, Caladea) and the Bitstream Vera licence (DejaVu).

  Every one of these runs as a separate process in its own image; no DPF code links to it, so no licence obligation reaches DPF source. The image ships Debian's binary packages unmodified, and their corresponding source stays available from Debian.
- **Data residency:** fully local. No document leaves the installation, which
  is why a hosted conversion API was rejected.
- **Regulatory:** not an AI system. It processes documents the installation
  already holds; no new personal-data flow.
- **Fit:** follows the `dpf-promoter` precedent: a DPF-built image published by
  `publish-image.yml`, launched one-shot by the portal through the docker
  socket it already holds. It is kept out of compose, because an optional
  pinned image there froze `promote-latest` (PR #5290). S9 retires mammoth,
  read-excel-file and pdf-parse once the engine serves every install shape.
  That is the absorb-don't-adopt ledger for this image.

## Integration evidence

On 2026-09-24, `Dockerfile.doctools` was built on linux/amd64 (Docker 29.8) and
`tools/doctools/smoke.sh` passed every check:

- the runtime user is non-root;
- all exit codes behave as documented;
- `.doc`, `.xls`, `.ppt`, `.rtf`, `.odt`, `.pptx`, `.docx`, `.xlsx`, `.ods` and
  `.odp` each converted to PDF and to text carrying the fixture sentinel;
- the macro control fired under the permissive profile, and the marker stayed
  absent under the hardened profile and through `dpf-convert`.

The image measured 217,598,894 bytes compressed (about 208 MiB) and
807,708,304 bytes unpacked. The size budget is set at 300 MiB compressed, well
under the backlog item's 700 MB ceiling.

One finding shaped the test: headless `--convert-to` loads documents hidden and
fires no document events. A macro probe built only on it would pass whatever
the profile said. The smoke test therefore uses a visible UNO load for its
control.

## Conditions

1. The runtime (S2) must run the image with `--network none --read-only`, a
   `/tmp` tmpfs, `--cap-drop ALL`, `no-new-privileges`, and memory and pid limits,
   and must pin it by digest.
2. Never add a compose service or profile for the engine.
3. Never relax `registrymodifications.xcu`. A new document feature that needs
   macros or links is a new evaluation. The one evaluated exception is
   `dpf-render` (see the addendum below).
4. Keep `smoke.sh` and the size budget in the release path. A release that
   cannot run them does not publish the image.
5. Re-evaluate before adopting unoserver or any warm, always-on listener.

## Addendum 2026-09-25: dpf-render (BI-3A0E5413, slice S6)

The image gains a second entry point, `tools/doctools/dpf-render`, which fills a
template from a validated JSON content spec on the image's `python3-uno` bridge.
Nothing is added to the image's package list.

Charts are embedded chart objects, and `DisableActiveContent` refuses every
embedded object: with it on, no chart can be created in a deck, report or
sheet. `dpf-render` therefore sets `DisableActiveContent` to false in its own
per-run copy of the profile, and only there. The baked
`registrymodifications.xcu` and `dpf-convert` are unchanged.

| # | Category | Severity | Finding | Required treatment |
| --- | --- | --- | --- | --- |
| 11 | Linked content | medium | With `DisableActiveContent` off, an embedded or linked object in an opened document would load. | `dpf-render` opens no untrusted document. It opens either a blank document or a flat-ODF template, and it refuses any template with an embedded object, an applet or plugin, DDE, a script or event binding, or an `xlink:href` that leaves the document (exit 2) before the engine sees it. Every chart is created by the script from validated numbers. Macro execution stays off (`MacroExecutionMode` NEVER on load, and the profile), OLE automation stays off, link updates stay never (`UpdateDocMode` NO_UPDATE), and the container still has no network. `smoke.sh` proves that a template carrying scripts is refused. |
| 12 | Resource management | medium | A spec can ask for many pages, images and charts. | The portal validates every spec first (`apps/web/lib/documents/generation/spec.ts`: bounded slides, rows, series, image sizes). `DPF_RENDER_MAX_BYTES` refuses an oversized request (exit 4), `DPF_RENDER_TIMEOUT_SECONDS` stops the run (exit 124), and the container keeps the same memory and pid limits. |
| 13 | Data/control boundary | low | Generated spreadsheets are opened later on people's own machines. | Formulas that reach outside the workbook (`WEBSERVICE`, `FILTERXML`, `DDE`, `HYPERLINK`, `INFO`, `CALL`, `REGISTER`, `RTD`, `EXEC`, URLs, other files) are refused in the spec. |

Condition 3 now reads: `dpf-render` alone may lift `DisableActiveContent`, in its
per-run profile, while the template screen above stands. Any other relaxation,
or opening an uploaded document through `dpf-render`, is a new evaluation.

## Addendum 2026-09-25: the trusted document path (BI-BFF142A1)

Founder decision, 2026-09-25: trusted path only. S6's findings 11 to 13 are
accepted. `dpf-convert` stays fully hardened for customer files. `dpf-render`
alone lifts `DisableActiveContent`, in its per-run profile copy, and only for
blank documents, screened flat-ODF templates, and (new here) flat ODF that DPF
generated itself.

Reproduced on `c9fd3d7c126`: `dpf-convert` exits 3 for a flat ODS carrying one
bar chart object. Relaxing only `DisableActiveContent` makes the file load.
Relaxing only `DisableOLEAutomation` or only `BlockUntrustedRefererLinks` does
not. Measured on the same image: a zipped `.ods` or `.odt` with a chart does
convert. Its text is read, the PDF keeps the chart's stored picture, and the
`.docx`/`.xlsx` output drops the chart. The hardened profile is therefore not a
blanket refusal of every customer file with a chart. The honest-message check
runs only after the converter refuses a file.

| # | Category | Severity | Finding | Required treatment |
| --- | --- | --- | --- | --- |
| 14 | Linked content | medium | `dpf-render`'s document mode opens a DPF-written flat ODF that embeds chart objects, with `DisableActiveContent` off. | The portal writes the document (`export-fods.ts`); no customer bytes are sent. `dpf-render` screens it first (exit 2 on refusal). Each embedded object must be an inline chart sub-document with no attribute but `draw:notify-on-update-of-ranges`, at most 16 per document. Each chart body and the rest of the document must pass the template screen: no scripts, event bindings, DDE, applets, plugins, OLE objects, floating frames or external links. The document opens with `MacroExecutionMode` NEVER and `UpdateDocMode` NO_UPDATE, in a container with no network. `smoke.sh` section 6 proves that a non-chart object, an external link inside a chart, and a document with scripts are each refused. It also proves that the macro probe stays negative under the render profile. |

Condition 3 now reads: `dpf-render` alone may lift `DisableActiveContent`, in
its per-run profile, for specs, screened templates and screened DPF-generated
flat ODF. `dpf-convert` and any customer-supplied document never get the
relaxed profile. Any other relaxation is a new evaluation.

## Sources

- [LibreOffice security advisories](https://www.libreoffice.org/about-us/security/advisories/)
- [LibreOffice licence (MPL-2.0)](https://www.libreoffice.org/about-us/licenses)
- [Debian libreoffice source package](https://tracker.debian.org/pkg/libreoffice)
- [Debian poppler source package](https://tracker.debian.org/pkg/poppler)
