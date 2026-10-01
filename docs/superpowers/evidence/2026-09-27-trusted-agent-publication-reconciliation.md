# Trusted-agent publication reconciliation

**Backlog:** BI-928E1B0F · **Epic:** EP-B932453F · **Workroom:** WC-57F2F2C5
**Source baseline:** `63c8cf5e2c0f9f0d5da0ed17c58f9a8135a5289b`, merged PR #5787.

This records the initial public narrative update, not completion of the programme's
publication milestone. Live backlog records own delivery status. No runtime,
qualification, interoperability or certification result is asserted here.

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
