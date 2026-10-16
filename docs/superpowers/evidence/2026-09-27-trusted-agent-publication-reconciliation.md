# Trusted-agent publication reconciliation

**Backlog:** BI-928E1B0F · **Epic:** EP-B932453F · **Workroom:** WC-57F2F2C5
**Source baseline:** `63c8cf5e2c0f9f0d5da0ed17c58f9a8135a5289b`, merged PR #5787.

This records the initial public narrative update, not completion of the programme's
publication milestone. Live backlog records own delivery status. No runtime,
qualification, interoperability or certification result is asserted here.

## Current reconciliation — 2026-10-16

The September deployment failure below is historical. PRs #5834 and #5836 were
subsequently merged, and the public narrative was directly observed on October 1
(backlog evidence cmup5bzdw11zj01oldueql8xk). The October 16 homepage and linked
standards/guidance routes render. That observation does not establish complete
conformance or successful document downloads.

The parent observation at 19:03:29 UTC is recorded as cmvbc5n6f3zgk01pt4zazvugn.
An independent source/byte check for this repair reproduced its result:
all five existing public Word URLs returned HTTP 200 but only 131 or 132 bytes
of Git LFS pointer text, without DOCX ZIP magic. GitHub's
[Git LFS documentation](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage)
states that Git LFS cannot be used with GitHub Pages.

This source repair retains every existing inbound URL and reuses the exact
previously published LFS object bytes. Five exact-name attributes keep these
public downloads as ordinary binary Git blobs. Other office/PDF assets remain
under their existing LFS rules. There is no Pages workflow, global LFS policy,
runtime-control or normative-standard change.

The source baseline is d9c8ed1fc887527c2a8b893f9a8062519c5a4384. The retained
bytes below match the SHA-256 OID and size in each baseline LFS pointer.
Each ZIP was fully read with CRC validation and contains word/document.xml.
These are unchanged publication snapshots, not newly generated documents.

| Existing /architecture/ path | Retained bytes | Retained DOCX SHA-256 | Currency disposition |
|---|---:|---|---|
| Trusted-AI-Agent-Governance-White-Paper.docx | 1,318,828 | 5c959040a918efe1f16db0af74e39e98968a929deb755cb10a9836b4b1f738ed | Generated 2026-10-02; discussion draft 2.1. BI-6CC40F77 separately owns the reviewed next edition. |
| Trusted-AI-Kernel-Architecture.docx | 1,853,702 | d4339dae38861873adcb0785f073a17d5d9a655af48a3718ceaaa3fc2a3003fd | Generated 2026-10-01. Principle/data clause markers are present; this repair does not claim a complete current-source equivalence check. |
| GAID.docx | 653,340 | f6cdcd39a742b8163cc2db04e387efd59caa82ddcdd3a511d5c9bb373e15b70a | Generated 2026-10-01. Principle-binding and identity-boundary markers are present; full source currency remains separate. |
| Job-Specific-Intelligence.docx | 270,302 | ae7fa202e16184cc03199254739fd4b0d15050d2c9a5b2ebadc46921eb568979 | Generated 2026-10-01. Principle, coordinator and authorization-envelope sections are present; full source currency remains separate. |
| Gated-Permissions-Process.docx | 1,779,482 | 4b37ac6174b1689aed98dc77ad7c23d723aa11c563d415b5c8ed276fd500c2ca | Generated 2026-10-02; draft 0.8, not the baseline Markdown draft 0.18. Explicitly labeled a snapshot; refreshed normative publication remains owed. |

The homepage now distinguishes existing controls, partial implementation, shadow
observations and unfinished assessments. It no longer calls the standards proven,
claims historical MBSE novelty, or states that all GPP-bound calls are currently
enforced/unreachable. The shared download note makes the dated snapshots and
known GPP revision gap visible before download.

The recorded scoped copy decision is DI-93B1A8B865BC: retain the existing cards
and download labels with a shared snapshot note rather than repeat five expanded
labels. Its comparative feature magnitudes are engineering estimates, not
measured usability or safety outcomes. Static rendering and actual served-byte
verification are recorded separately.

The repair's local observation is cmvbcfmp845y001pt8slhzueb: a static HTTP
preview returned all five complete ZIP files with the retained hashes, while
desktop (1280 × 900) and mobile (390 × 844) browser checks showed the snapshot
notice and unchanged download links without horizontal document overflow.
The documentation index was regenerated without a content change (746 pages),
and the user-guide link check passed for 93 pages. These checks do not establish
a Jekyll build, accessibility certification, or production deployment.

This entry describes a repair candidate, not a merged/deployed result. Local
static HTTP byte verification cannot establish public Pages deployment. After
merge, record the actual Pages deployment and re-fetch all five public URLs,
comparing the returned ZIP bytes with the retained hashes. The publication
milestone remains open while known source-currency or assessment gaps remain.

## Surface dispositions

| Surface | Disposition and evidence | Remaining owner |
|---|---|---|
| `docs/index.html`, existing standards section | Adds the complete operating composition, scoped principles versus permission, MBSE trace and links to the merged draft clauses. Retains the working-draft label and explicitly identifies portable contracts and demonstrations as unfinished. Existing layout, route and card structure are retained. | BI-928E1B0F verifies rendering and deployed content for this revision. |
| TAK, GAID, JSI, standards-family and external-alignment sources | Updated by PR #5787. This slice links those canonical owners rather than copying their normative clauses. | BI-A484D58F retains independent review/acceptance. |
| `docs/user-guide/ai-workforce/how-governed-work-runs.md` | Inspected: already distinguishes recommendation from permission, three decision scopes, posture and work shape, and known limits. This slice does not rewrite its existing runtime claims without verifying the relevant implementation. | BI-928E1B0F owns the later user-guide reconciliation. |
| `agent-standards-dpf-conformance.md` and contribution roadmap | Inspected. The former is a broad first-pass source assessment, not a fresh runtime result; the latter already identifies the family as R0. No status is promoted in this slice. Earlier research read claims overlap these paths; scope release requires DPF employee approval. | BI-2AB781FA / BI-F3C2EC7A supply assessed evidence; BI-928E1B0F reconciles publication. |
| Existing white-paper source | Inspected; its market/standards claims and references require a dated revision with the new argument. Not silently rewritten as part of the homepage copy. | BI-6CC40F77. |
| Word downloads and diagrams | Canonical publication manifest is `docs/architecture/agent-standard-publications.mjs`. Regeneration uses the existing document-export pipeline. Not regenerated or claimed current with the new amendments by this slice. No new diagram is introduced. | BI-928E1B0F with the white-paper owner. |
| Public site deployment | Existing GitHub Pages publication channel; source merge, successful deployment and rendered content are separate evidence events. | BI-928E1B0F records the actual deployment/observation. |

## Claim-to-evidence boundary

- The proposed principle-directed requirements and modeling crosswalk are source
  documents delivered by PR #5787, not a claim of implemented enforcement.
- Existing DPF control descriptions remain subject to their own source/runtime
  evidence. A new standards paragraph cannot upgrade their conformance status.
- Portable contracts are BI-F9582C48; assessment is BI-2AB781FA; DPF demonstration
  is BI-F3C2EC7A; Hermes and Cursor bindings are BI-FEA232AF and BI-0E56BA38.
- No standards body, regulator, publisher or external implementer is represented
  as endorsing this work. External submissions remain separately authorized.

## Verification scope

The link fragments match the source headings `MBSE Composition Mapping` and
`7.13 Principle-Directed Decision Contract`. The documentation index is fresh
(722 pages), user-guide link checks pass (86 pages), and `git diff --check` passes.
The static homepage was exercised in the Codex browser at 1280-pixel and
390-pixel widths: the new copy, links and posture notice wrap without document
horizontal overflow. This is static rendering evidence, not a Jekyll build.

GitHub Pages run [36361616492](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/actions/runs/36361616492)
failed after the baseline merge: Liquid interprets the existing MessageFormat
example in `docs/architecture/localization-runbook.md` as a template expression.
The failure is recorded as `cmuki7c1zfr2c01p7q0f2goic` against this backlog item.
Public deployment and the new deep links therefore remain unverified. That
architecture path is covered by an earlier active read claim; scope-release
approval remains outstanding. No control was bypassed to edit it.

There is no new application behavior, data migration
or live policy setting. The later publication milestone remains open until its
user guidance, downloads, white paper and deployed-content evidence are reconciled.
