# Trusted agent engineering: LF/TBM discussion packet

**Status:** prepared for operator review, October 16, 2026. **Delivery:** BI-1C39CCF8 under EP-B932453F. **Meeting target:** TBM Conference, November 9–11, 2026, Miami. This is discussion material, not an accepted session, foundation submission, endorsement, certification or complete conformance report.

## Use the packet

- [Two-page meeting brief](meeting-brief.pdf), with [editable text](meeting-brief.md).
- [Architecture deck](trusted-agent-tbm.pptx) and [PDF slides](trusted-agent-tbm.pdf). Twelve editable slides; citations are in speaker notes. `deck-outline.json` contains the editable outline and notes.
- [Synthetic-expense demo script and static fallback](demo-script.md). The static fallback is explicitly a walkthrough. No live run or recording is claimed.
- [Known gaps and evidence boundaries](known-gaps.md).
- [Governance/IP options and proposed collaboration request](governance-options.md).
- [Source register](sources.md), checked October 16, 2026.

Start with the brief, use the deck for the architecture discussion, and keep the gap sheet beside it. Before external use, refresh source/runtime identities and the dated gap statements. Sharing or submission still needs explicit owner authorization.

## Canonical owners

This packet explains the existing [standards family](../../architecture/agent-standards-family.md). It adds no normative requirements. The [external alignment](../../architecture/agent-standards-external-alignment.md) owns standards mappings; the [contribution roadmap](../../architecture/agent-standards-contribution-roadmap.md) owns venue allocation and readiness gates. Technical detail stays in those documents and their linked normative owners.

## File provenance and reproduction

The authorized DPF presentation tool returned `converter-unavailable` because its document-engine image is unconfigured; nothing was saved. No runtime configuration or permission was changed. This packet therefore uses a local, editable artifact-tool deck, not a managed DPF document. Its neutral typography and colors are an editorial design, not a claim that the organization's live brand record was read.

The deck builder, `build-deck.mjs`, consumes `deck-outline.json`. It requires the Codex bundled `@oai/artifact-tool` runtime and presentation finalizer; no dependency is added to DPF. Pass a private build directory and the presentation skill directory, with `ARTIFACT_NODE_MODULES` and `ARTIFACT_PYTHON` pointing at the discovered runtime. It exports a candidate, validates the package/layout/import, and writes previews. The PDF builder, `build-pdfs.py`, produces the two-page brief and slide PDF from the Markdown and verified previews using ReportLab; the latter is a static view while the PPTX remains editable. Build logs and validation diagnostics are evidence, not presentation content.

No provider inference, real payment, bank access, qualification grant or external reproduction was performed to produce these files.
