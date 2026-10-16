---
status: active
backlogItem: BI-928E1B0F
epic: EP-B932453F
---

# Refresh the four normative trusted-agent Word editions

For agentic workers: execute this plan one independently reviewable backlog item
at a time. Use `dpf-local-merge-ci-before-push` and the actual gate context before
publication, and `dpf-pr-with-dco` for handoff. Source implementation defects are
separate from this documentation delivery; do not place new generic helper code
under its doc-only readiness profile.

## Objective and boundary

Regenerate the existing TAK, GAID, TAK-JSI and GPP Word downloads from exact
canonical sources using the existing publication catalogue and normally delivered
renderer/layout prerequisites. Preserve their inbound URLs, plain-blob storage
exceptions and draft/partial-evidence claims. Prove final source/content parity,
inspect every final rendered page and verify the released HTTP bytes.

This is the remaining edition part of BI-928E1B0F. PR #6462 delivered the earlier
snapshot-download/public-claim correction at
`46bd5e2414bc90c1864016ef9d2159c2602fc5d7`; those bytes and its evidence remain
historical. That PR did not regenerate the retained October 1–2 Word snapshots.
The snapshot warning remains accurate until each replacement is reviewed,
published and verified. The revised white paper belongs to BI-6CC40F77 / PR
#6466, whose separate typed acceptance is not reopened here.

No normative prose, model policy, authority, qualification, runtime control,
website redesign, CI/LFS policy or whole-platform conformance claim changes in
this plan. It cannot close the broader epic or grant source access.

## Governing source and recorded acceptance

Reuse the documentation/public-surface map in
[the programme baseline](../specs/2026-09-27-trusted-agent-mbse-baseline-design.md)
and the existing publication catalogue
[`agent-standard-publications.mjs`](../../architecture/agent-standard-publications.mjs).
The canonical Markdown and Mermaid inputs remain the authoring sources.
Generated Word packages are derived editions.

The live BI body, read on October 16, 2026, has these acceptance criteria,
quoted verbatim:

- Every affected documentation/public surface in the baseline has a reviewed change or explicit no-change disposition and accountable owner.
- Public claims, canonical standards, reference implementation evidence and the white paper agree for the released version; draft concepts are clearly labeled.
- Updated diagrams and downloads match their source versions; existing inbound links resolve or receive maintained redirects.
- Content review and applicable source checks are recorded; live verification is recorded after release, never inferred from a draft.
- The programme's publication milestone is not complete while known stale claims remain on its in-scope public surfaces.

This plan supplies only the four-edition subset. Other baseline rows and
implementation/portability evidence keep their existing accountable BIs.

## Actual observations and dependencies

Initial planning base is `bf39a9fd58536171e7dd6b136d13e5192f86904d`.
The existing managed checkout is
`/Users/markbodman/.codex/worktrees/trusted-agent-publication-repair/dpf`,
branch `codex/trusted-agent-word-editions`, Workroom `WC-4C700C83`.
The normal plan-intent claim returned `IRD-4E5357EF0CEB`, doc-only, medium.
The delegated executor is
`01a0e457-d885-74b0-9582-44695433fffd/book_materials`.

The earlier `WC-B0709AFB` attempt is archived after actual PR #6462 delivery,
live verification and ordinary scope release. Its frozen branch head remains
`49a2c5495d3782f15a1603083bad64fb4ed8683a`.
Archiving that completed attempt does not complete this BI, transfer a peer's
source scope or execute a pending approval.

The following prerequisites are distinct:

| Dependency | Actual disposition at plan authoring | Required before use |
| --- | --- | --- |
| BI-7939AE2A / PR #6467 | Separate generator freshness/failure repair, head `068fe0c2d5cbe7bea480b1b14f97a69f72ad61ca`; open at last parent observation | Merge through its own gates; inherit actual main bytes rather than copy its patch |
| BI-6CC40F77 / PR #6466 | White-paper delivery includes the shared image-extent helper; separately owned and accepted. Its owner ordinarily released remaining helper/paper claims at WC-616A sequence57 | Verify merged helper identity and obtain any exact claim before use; no duplicate helper |
| Table layout and GPP rendering configuration | Actual private candidate/preservation/visual evidence exists; reusable source repair is not admitted by this doc-only BI | Capture/reuse a separately classified implementation defect and its proportional design, normal ownership, checks and source delivery |
| Existing normative Word paths | Parent's release request covers GAID, JSI and GPP Word outputs and was pending at plan authoring; TAK is not part of that claim | Observe actual ordinary release of the three peer-held paths and normally claim all four outputs; no force, elapsed-time assumption, alternative room or copied approval |
| GPP ownership hazard cross-reference | Separate BI-A484D58F editorial owner will repair the stale §13 `escalate` reference | Consume its final source pin after delivery; do not duplicate its normative edit |
| Public snapshot note and reconciliation ledger | Current white-paper owner coordinates those shared surfaces | Obtain ordinary scope handoff for the exact final note/ledger delta |

The private package
`/tmp/dpf-standards-word-candidates-c0b47d1e/PRIVATE-HANDOFF.md` is research,
not an import authority. Its 97 reviewed pages cover earlier GAID/JSI/GPP
candidates only. The final GPP seeded fence-3 PNG differs, final normative pins
can advance and TAK now has an observed extent problem. Final edition QA is
therefore owed; do not relabel that private package as final.

A complete untruncated live epic inventory on October 16 returned 60 items.
It contains the separately scoped generator BI and the completed historical
BI-56C4EFCF; it supplies no currently open standalone table/config repair.
This is an overlap observation, not permission to create or implement source
under a documentation classification.

## Source map and required dispositions

| Canonical input | Existing output | Edition disposition |
| --- | --- | --- |
| `docs/architecture/trusted-ai-kernel.md` and `tak-diagrams/` | `docs/architecture/Trusted-AI-Kernel-Architecture.docx` | Regenerate current prose with image extents fitted; inspect all final pages. Retained Word extents exceed usable width for all seven measured images and height for six; render establishes visible impact separately. |
| `docs/architecture/GAID.md` and `gaid-diagrams/` | `docs/architecture/GAID.docx` | Regenerate current source, fresh diagram pairs and reviewed publication layout. Figure 5's old PNG omitted arrows/text present in source; do not reuse it. |
| `docs/architecture/job-specific-intelligence.md` and `jsi-diagrams/` | `docs/architecture/Job-Specific-Intelligence.docx` | Regenerate current source and reviewed publication layout; preserve Defined/Assessed/Qualified distinctions. |
| `docs/architecture/gated-permissions-process.md` and `gpp-diagrams/` | `docs/architecture/Gated-Permissions-Process.docx` | Regenerate the final separately owned source revision with normally delivered font/seed configuration. Inspect the new fence-3 image in the final pages. |

At source freeze, record full commit, Git blob and SHA-256 for every Markdown,
Mermaid, configuration, generator, shared helper, publication catalogue,
lockfile and relevant package input. Record the actual pinned renderer and
converter digests. If source changes before publication, invalidate parity for
affected editions and regenerate/review them. A no-change disposition needs
actual content and layout evidence; source identity alone does not excuse the
known TAK layout defect.

## Sequencing and functional verification

The four editions are one bounded publication-reconciliation packet for the
already existing BI. Freeze, generation, layout, QA, publication and download
verification are internal completion activities, not separately shippable
features. Independently shippable helper/config code, the white paper, normative
editorial corrections and conformance implementation remain separate work.

### 1. Admit the final scope and pin inputs

Obtain actual peer scope release, normally claim the four output paths and any
generated diagram assets/public note/ledger paths that the final change needs.
Refresh the plan's scope coverage rather than reusing this initial plan-only
claim. Consume the returned `changeImpactContract` and run `pnpm gate:context`
on the real diff. Its current plan-only contract is resolved, contains no
`testImpact` or `guardObligation` entries and names the doc-index derived check.
That does not preselect the eventual binary/config lane.

Refresh the clean branch from main after prerequisites land, preserving the
old branch and immutable review history. Verify current AGENTS.md and source
pins. Do not absorb another owner's patch or silently rebase unknown work.

**Verification:** exact normal claim/readback, source manifest, current plan
coverage and explicit disposition of every dependency. A permission refusal
stops only that denied action; unrelated authorized research can continue.

### 2. Generate and validate the actual editions

Use `generate-agent-standard-docx.mjs` and its existing catalogue for each of
`tak`, `gaid`, `jsi`, `gpp`; do not run `all` and overwrite the separately
owned white paper. Use the normally delivered freshness generator, pinned
networkless renderer/converter and the shared extent helper. Apply the
separately delivered table/config fix only after its own admission/merge.

Retain raw output, post-processing identity, ZIP package checks and final
byte hashes outside the published assets. Verify exact paragraph/table text
and intended heading/reference/diagram counts against the canonical inputs,
with explicit generator transformations such as the title page, numbering or
Markdown rendering. Review differences rather than calling text extraction
equality sufficient for semantics.

**Verification:** genuine DOCX ZIP/CRC/content-types/relationships/word document,
source-version/date parity, unchanged normative wording, expected media,
hyperlink and heading integrity, layout-only transform preservation and
idempotence where the adopted helper promises them. Converter success alone is
not an adequate edition check.

### 3. Render and independently inspect all final pages

Use bundled `render_docx.py` with its bundled LibreOffice, never the user's
desktop application. Save final PDF/page PNG identities. Inspect every page at
original resolution for clipping, missing glyphs/arrows, table splits, header
repetition, overflow and readable figures. Explicitly disposition the tall GPP
process figures: no off-page pixels does not establish legibility. If page-fit
labels require zoom, retain accessible full-resolution diagram companions and
state that presentation limit. A page may reuse an earlier visual
inspection only after exact final page-PNG byte equality is proven; record the
source inspection and equality. A contact sheet or character-bounds test is a
navigation aid, not a substitute.

Run source/package accessibility checks for semantic headings, real table
headers, alternative text and links; record actual omissions. Repair layout in
the responsible source/helper rather than hand-edit prose in the Word binary.
Re-render after every layout-sensitive change. Record native Word and
screen-reader testing as unrun unless actually performed.

**Verification:** independent CLIENT content/layout assessment of exact final
sources and bytes, all-page QA ledger, package/source proofs and concrete
limitations. These assess publication quality, not native semantic approval,
standards ratification, model qualification or runtime safety.

### 4. Publish through ordinary gates and verify returned bytes

Update only the exact shared snapshot-note and reconciliation-ledger rows
covered by actual edition evidence; keep warnings for any remaining stale
edition. Preserve existing download paths and their exact plain-blob
exceptions. No global LFS, Pages or CI change is needed.

Run checks selected by the actual gate context, current policy preflight and
required canonical gate. Seek native committed-change review with truthful
full source identity and failure analysis; preserve any real artifact-capacity
or adapter refusal as unrun/inconclusive. The known native artifact bound is
2 MiB; binary edition diffs can exceed it. An equivalent assembled artifact
must meet the actual end-to-end tool contract; never relabel a digest or
truncate the binary diff. Keep independent CLIENT review separately
attributed. Follow the actual publication policy without changing it.

Commit with DCO, push normally, open one ready PR, attach it, follow
`pnpm pr:health` and let the protected merge queue land it. Resolve actual
findings, preserve all historical receipts and record the terminal outcome.

After actual Pages deployment, verify build/source commit and fetch each
existing public Word URL. Record HTTP status, length, SHA-256, ZIP/CRC and
`word/document.xml` against the deployed Git blobs. Inspect the final public
note and each link on desktop/mobile. A merged PR or green Jekyll build is not
deployment/download proof.

**Verification:** canonical source/independent review evidence, merged SHA,
actual deployment record and downloaded-byte proof. Reconcile this BI's
edition subset honestly; do not complete its full baseline or the epic from
these four files.

## Risks and rollback

Binary editions make raw semantic diffs large; preserve full exact bytes and
source provenance rather than hiding them behind a success summary. Renderer
timestamps may prevent identical regenerated ZIP hashes; deterministic inputs,
package/content checks and actual output hashes still need recording.

Long diagrams and annex tables may remain hard to read. Existing source parity
does not prove layout quality. A current-source version is preferable to an
old snapshot only after final content/layout verification passes.

Revert the bounded edition/public-note PR through the ordinary queue if final
download delivery is wrong; retain the prior working snapshot paths/storage
rules and describe their real snapshot status. Do not roll back normative
standards, runtime policy or historical receipts to make a publication pass.

## Backlog coverage

Parent: BI-928E1B0F. Existing separate dependencies: BI-7939AE2A,
BI-6CC40F77 and the BI-A484D58F-owned GPP editorial correction.
The reusable table/config source defect still needs its own normal live
capture and admission before implementation.

Proposed atomic mapping for this edition-only packet:

- requirement reference: `EDITION-REQ` — the four refreshed Word editions and the quoted BI acceptance subset above.
- contract reference: `EDITION-CONTRACT` — canonical Markdown/Mermaid/catalogue to existing URLs, with draft and evidence boundaries preserved.
- flow reference: `EDITION-FLOW` — source freeze → generation → all-page review → gated publication → deployed byte verification.
- verification reference: `EDITION-VERIFY` — exact source/package/layout, independent CLIENT, canonical checks and actual HTTP-byte evidence.

No live plan coverage receipt is claimed yet. Record against the immutable
committed plan through `record_plan_backlog_coverage`; the server selects the
applicable schema. Reconcile exact declared scope and refresh coverage after
the final ordinary claims are admitted. A Markdown checklist is not coverage
or implementation permission.
