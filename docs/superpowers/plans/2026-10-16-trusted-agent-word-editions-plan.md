---
status: active
backlogItem: BI-928E1B0F
epic: EP-B932453F
---

# Finish trusted-agent publication reconciliation and Word editions

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

The edition recipe below is the remaining edition part of BI-928E1B0F. PR #6462 delivered the earlier
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

The current admitted packet is the bounded reference/projection reconciliation
below. The four-edition recipe remains a future packet: no current coverage or
source claim grants its held assets. Other baseline rows and implementation /
portability evidence keep their existing accountable BIs.

## Current packet: references and accountable publication projections

The initial plan was committed and normally pushed as
`e2bcebd1a93793a953efacc1a097987a796a8da6`. Its plan-only coverage receipt is
`cmvbf7m2w5h3e01ptvjzj63gb`; documentation evidence is
`cmvbf5u7q5h2001pt0u0mcgnd`. Its single native PLAN request,
`TR-GATE-230EB5D4153D74876542BB74`, was actually observed input-required /
provider-outcome-uncertain with no verdict or receipt. That immutable request,
deadline and evidence remain historical; changing this plan cannot settle or
retry that execution.

A bounded source/publication audit is recorded as
`cmvbfsagg5rot01ptnjn5t1gj`, October 16 at 20:45 UTC. The 34 selected source
blobs at `bf39a9fd58536171e7dd6b136d13e5192f86904d` were unchanged at current
main `250447587496308226abc10aca79ee006ecd10f6`. Actual HTTP observations
identified 12 failed authored targets in 17 occurrences. Five Word and three
TBM PDF/PPTX downloads returned genuine packages; this does not make the four
old normative editions current. Thirty-nine sampled fragment targets exist.
No all-site, runtime, accessibility or cache-freshness verdict was made.

At 20:45:16 UTC, ordinary `claim_workroom_scope` admitted exactly the eight
paths below in WC-4C700C83, in addition to this plan. It returned a resolved
change-impact contract with no test-impact or guard-obligation entries. Derived
checks are the doc index, doc-impact manifest and rendered guide diagrams.
Run those actual checks; no generated-file claim is implied by this source claim.

| Claimed source | Bounded correction |
| --- | --- |
| `docs/architecture/agent-standards-family.md` | One broken composition-design reference |
| `docs/architecture/agent-standards-external-alignment.md` | One broken composition-design reference |
| `docs/architecture/trusted-ai-kernel.md` | One broken composition-design reference and one wrapped PAAW link; no normative obligation change |
| `docs/architecture/trusted-agent-reference-contract.md` | Two broken excluded-design/plan references; preserve actual approved-design provenance |
| `docs/architecture/work-shapes-and-the-decision-gate.md` | Six broken excluded-source/reference occurrences |
| `docs/user-guide/ai-workforce/decision-perspective.md` | One wrapped practice-guide link |
| `docs/architecture/agent-standards-dpf-conformance.md` | Date and qualify the source-declared first-pass projection; correct five stale source-path occurrences without a new assessment |
| `docs/superpowers/evidence/2026-09-27-trusted-agent-publication-reconciliation.md` | Dated source/live/download/owner dispositions; actual white-paper 2.2 delivery and remaining publication work |
| `apps/web/lib/docs/doc-impact.generated.json` | Existing derived source-reference graph only; no new runtime code or graph substrate |

The first source checks found the doc index and 42 guide diagrams fresh, but
the doc-impact graph stale after the five corrected source locators. Its exact
generated path was ordinarily claimed at 20:48:08 UTC before regeneration.
The nine-path coverage `cmvbftzxv5tz001pthkqtyo43` was valid before this added
derived scope; refresh it for all ten paths before generating that artifact.

This is thirteen reference occurrences plus their related publication
projections. Intentionally excluded drafts remain excluded: use immutable
GitHub source URLs at the verified source commit. Existing published PAAW and
practice-guide pages remain authoritative. Do not unexclude directories, rename
standards, alter a parser/guard, or publish a new normative surface to eliminate
a 404. Verify each replacement target and preserve fragments.

Live ownership was checked: BI-1139F962 is open and retains broad PAAW public
harmonization; BI-4E32C6A2 is done, with historical filename/redirect follow-ons
still described in its body. Neither has an active room. This packet repairs
only a malformed link to the actual existing PAAW page, without taking over
their naming, migration or guard work. BI-2AB781FA / BI-F3C2EC7A retain the
clause/test/evidence and actual-runtime assessment; a current source locator is
not an implementation result. BI-A2A71149 retains separate end-to-end document
lifecycle acceptance. Book, TBM and white-paper typed delivery remains separately
attributed, not re-approved by their publication author.

Four failing occurrences in peer-held JSI and GPP sources remain proposals only.
The parent's eight exact claims and pending release decision have not been
executed by this packet. No alternative room, force claim, elapsed lease,
historical approval or source copy is a transfer. The separate GPP section 13
editorial erratum remains with BI-A484D58F.

### Current packet sequence and verification

1. Preserve the e2 source and native history. Commit and normally push this plan
   amendment, record fresh scope-bound immutable coverage, validate it, then
   re-claim implementation with the same delegated session and exact head.
   No public source edit precedes those actual permissions.
2. Correct only the claimed references and dated publication projections.
   Preserve old evidence and distinguish new observations, historical snapshots,
   source declarations, unassessed related guides and independently owned proof.
3. Run the actual diff's gate context, derived freshness checks, guide links,
   source checks and required documentation gate. Exercise the site build's
   link transformation and the changed guide at desktop/mobile. Record source /
   static verification limits; no browser navigation to the operator's approval.
4. Obtain independent CLIENT review of the exact frozen diff and seek native
   committed-change review under current policy, without retrying the old
   uncertain PLAN task. Preserve any actual infrastructure limitation. DCO push,
   one ready PR, attachment and protected merge queue remain mandatory.
5. After the actual Pages build, fetch each changed public page and replacement
   target; record returned content and the old-to-new dispositions. Reconcile
   only this packet, not the held sources, four editions or wider programme.

**PUB-REQ:** the quoted live BI acceptance criteria applied to the observed
reference failures and source-only publication projections.

**PUB-CONTRACT:** exact existing routes and authoritative public/immutable-source
targets, with no authority, normative or qualification change.

**PUB-FLOW:** admitted scope → immutable plan coverage → bounded correction →
independent review / documentation gate → protected publication → actual GET.

**PUB-VERIFY:** exact changed text and source identities, transformed links,
derived/source checks, separately attributed CLIENT/native outcomes and dated
actual public responses, with explicit unassessed/runtime boundaries.

For the current coverage record, these are internal steps of one publication
repair packet under BI-928E1B0F, not independent features. The future four-Word
edition packet needs its own current scope/coverage before mutation; its recipe
below is retained to make that remaining dependency explicit.

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
| BI-7939AE2A / PR #6467 | Separate generator freshness/failure repair merged as `250447587496308226abc10aca79ee006ecd10f6`; earlier reviewed source was `068fe0c2d5cbe7bea480b1b14f97a69f72ad61ca` | Inherit actual main bytes at the final edition freeze rather than copy its patch |
| BI-6CC40F77 / PR #6466 | White-paper delivery includes the shared image-extent helper; separately owned and accepted. Its owner ordinarily released remaining helper/paper claims at WC-616A sequence57 | Verify merged helper identity and obtain any exact claim before use; no duplicate helper |
| Table layout and rendering configuration | Separately captured BI-1B66A62E is ordinarily admitted to the programme source owner in WC-FE71CAF2; private candidate/preservation/visual evidence is not source delivery | Consume that owner's actual source merge/gates and final renderer/config pins; do not absorb generic source code under this doc-only BI |
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
The reusable table/config source defect is separately captured/admitted as
BI-1B66A62E; source delivery remains its owner's responsibility.

Current packet maps atomically to BI-928E1B0F with `PUB-REQ`, `PUB-CONTRACT`,
`PUB-FLOW` and `PUB-VERIFY`. Reference fixes and dated source/publication limits
are one repair to the observed published reading path; their checks, provenance,
review and post-release observations are internal completion steps. They add no
independent capability. Record and validate fresh immutable coverage for the
ten actual claimed paths before the remaining derived implementation. The earlier
`cmvbf7m2w5h3e01ptvjzj63gb` covers only e2's original plan scope and is retained
as historical evidence, not reused for this changed scope.

Future edition-packet references, not authorized by the current packet:

- requirement reference: `EDITION-REQ` — the four refreshed Word editions and the quoted BI acceptance subset above.
- contract reference: `EDITION-CONTRACT` — canonical Markdown/Mermaid/catalogue to existing URLs, with draft and evidence boundaries preserved.
- flow reference: `EDITION-FLOW` — source freeze → generation → all-page review → gated publication → deployed byte verification.
- verification reference: `EDITION-VERIFY` — exact source/package/layout, independent CLIENT, canonical checks and actual HTTP-byte evidence.

Record against the actual immutable committed plan through
`record_plan_backlog_coverage`; the server selects the applicable schema. Copy
the resulting receipt into the next plan revision or canonical handoff without
pretending that a document can contain its own later receipt. Reconcile exact
scope again before the edition packet. A Markdown checklist is not coverage or
implementation permission.
