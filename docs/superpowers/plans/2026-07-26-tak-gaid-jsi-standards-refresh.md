# TAK, GAID, and TAK-JSI Standards Refresh Plan

| Field | Value |
|---|---|
| Backlog item | `BI-E90ACB87` |
| Work capsule | `WC-7624958F` |
| Decision record | `DI-B11B240AEA8F` |
| Branch | `doc/tak-gaid-jsi-standards-refresh` |
| Status | Verified; ready for delivery |

## Goal

Refresh the AI-agent standards family so it accurately represents the current DPF architecture:
TAK governs runtime trust and authority, GAID governs durable identity and advertised claims, and
TAK-JSI governs job-specific qualification and the evidence required to earn and retain autonomy.

## Decision grounding

The standards-family shape was consulted through the WWMD kernel before editing:

- `tak-section`: place JSI directly inside TAK.
- `peer-standard`: publish JSI as an independent peer to TAK and GAID.
- `tak-jsi-profile`: publish an independently versioned normative companion that depends on TAK
  runtime controls and binds its qualification claims through GAID.

The kernel recommended `tak-jsi-profile` with high confidence (composite `9.805`, margin `1.954`,
no commandment conflict). This preserves testability and independent versioning without presenting
JSI as a replacement for runtime or identity governance.

## Research grounding

The refresh adopts the following external patterns without copying their scope:

- NIST AI RMF: context-of-use measurement, pre-deployment testing, ongoing monitoring, and explicit
  limits on generalization.
- NIST AI Agent Standards Initiative and NCCoE agent identity work: secure agent identity,
  authorization, interoperability, and consumer-comparable evaluations.
- ISO/IEC 17024:2026: certification schemes define a job/function scope, assessment method,
  evidence, certification decision, surveillance, and periodic reassessment.
- ISO/IEC 25059:2023: consistent AI-system quality characteristics for specifying and evaluating
  quality requirements.
- ISO/IEC 5259 series: fit-for-purpose data quality, measurable data-quality characteristics,
  lifecycle management, and governance responsibility.
- W3C Verifiable Credentials 2.0 and 1EdTech Open Badges 3.0: issuer/holder/verifier separation,
  schema-bound claims, evidence, status, validity periods, and portable verification.
- O*NET and ESCO: a job is described through tasks, knowledge, skills, abilities/competences,
  work context, and occupation-specific requirements rather than one generic benchmark score.

## Refactoring allocation

Approximately 20% of the implementation effort is reserved for reducing standards-family drift:

1. Create one concise family map for ownership, dependency, and version relationships.
2. Replace repeated or contradictory boundary prose in TAK, GAID, the white paper, and conformance
   companions with short canonical statements and links.
3. Consolidate Word-publication configuration so TAK, GAID, and TAK-JSI use one manifest-driven
   generator path instead of accumulating another one-off entry point.
4. Separate normative controls from DPF implementation status so future platform changes do not
   accidentally rewrite the standard.

## Phase 1: Normative family

### Deliverable

Create the TAK-JSI profile and refresh TAK and GAID around the current autonomy, proactivity,
qualification, identity, data, and routing contracts.

### Files

- Add `docs/architecture/agent-standards-family.md`.
- Add `docs/architecture/job-specific-intelligence.md`.
- Modify `docs/architecture/trusted-ai-kernel.md`.
- Modify `docs/architecture/GAID.md`.
- Add `docs/architecture/jsi-diagrams/01-jsi-qualification-lifecycle.mmd`.
- Add generated SVG/PNG companions under `docs/architecture/jsi-diagrams/`.

### Required content

- Distinguish declared capability, tested capability, job qualification, operating authorization,
  and earned autonomy.
- Define a job qualification scheme from job/tasks, WSID/profession corpus, decision axes,
  tool/authority envelope, data classes, model/provider constraints, scenario evaluations,
  outcome evidence, and human-oversight boundaries.
- Treat model and harness details as replaceable components behind evidence-based requirements.
- Require version-bound qualification, material-change invalidation, expiry/surveillance,
  suspension/revocation, and requalification.
- Define how proactivity requests work while TAK authority and regulatory/data ceilings remain
  non-bypassable.
- Define how Golden Triangle posture selects effort and assurance resources but cannot establish
  competence or override job/data constraints.
- Bind TAK-JSI qualification claims to a GAID AIDoc and capability/qualification badge.

### Verification

- Cross-check every new normative term against the family glossary and remove collisions.
- Confirm every `MUST` is testable through evidence or an explicit conformance assertion.
- Confirm the new profile does not redefine TAK grants/HITL, GAID identity, WSID craft doctrine,
  or Golden Triangle resourcing.

## Phase 2: Conformance, prototype assessment, and publication

### Deliverable

Align the family’s supporting material and generated publication artifacts to the normative update.

### Files

- Modify `docs/architecture/2026-04-18-trusted-ai-agent-governance-white-paper.md`.
- Modify `docs/architecture/agent-standards-dpf-conformance.md`.
- Modify `docs/architecture/tak-conformance-tests.md`.
- Modify `docs/architecture/gaid-conformance-tests.md`.
- Add `docs/architecture/jsi-conformance-tests.md`.
- Modify `docs/architecture/agent-standards-threat-model.md`.
- Modify the standards publication generator and `package.json`.
- Regenerate `docs/architecture/Trusted-AI-Kernel-Architecture.docx`.
- Regenerate `docs/architecture/GAID.docx`.
- Add `docs/architecture/Job-Specific-Intelligence.docx`.

### Verification

- Generate all three DOCX files from Markdown sources.
- Render every generated DOCX page and inspect for clipped text, broken tables, unreadable diagrams,
  bad page breaks, and missing images.
- Regenerate the documentation index and run repository documentation/link guards.
- Check that generated artifacts contain no internal tool tokens, placeholder citations, or stale
  two-standard-family claims.

## Backlog coverage

- Decision: `atomic`
- Receipt: `cms2fd3h70cis01qohgytxrw0`
- Parent: `BI-E90ACB87`
- `normative-family`: not independently shippable; no separate BI.
- `conformance-publication`: depends on `normative-family`, is derived from it, and is not
  independently shippable; no separate BI.

The standards family must land atomically because its documents define each other's boundaries.
Shipping a new qualification claim without the corresponding TAK runtime and GAID identity
bindings—or shipping conformance rubrics before the normative requirements—would create a
misleading public contract.

## Risks and rollback

| Risk | Mitigation |
|---|---|
| JSI duplicates TAK authority or WSID knowledge doctrine | Keep JSI limited to qualification composition, evidence, and lifecycle; link to canonical owners. |
| A badge becomes a marketing claim | Require scope, version, evidence, evaluator, validity, status, and material-change rules. |
| Generic model benchmarks masquerade as job fitness | Require job/work-context scenarios and outcome evidence; model cards are inputs, never qualifications. |
| Data sensitivity is treated as model quality | Keep sensitivity/residency as hard eligibility constraints distinct from competence scores. |
| Current DPF implementation is mistaken for normative completeness | Keep implementation status in the conformance assessment, not in the standard. |
| Publication artifacts drift from Markdown | Generate all artifacts from the shared manifest and verify their rendered output. |

Rollback is one PR revert because the work changes documentation and generation tooling only; it
does not migrate data or alter runtime behavior.

## Architecture review (advisory)

- **Alignment summary:** well aligned after edits.
- **Single source of truth:** TAK owns runtime enforcement; GAID owns identity and claim envelopes;
  TAK-JSI owns job qualification. The family map and linked companions summarize rather than
  redefine those contracts.
- **Substrate fit:** the profile extends existing AI Coworker, WSID, routing, proactivity, Golden
  Triangle, and autonomy substrate without adding runtime tables, enums, or migrations.
- **Standards fit:** the profile adopts context-specific evaluation, competence-scheme lifecycle,
  data-quality stewardship, portable evidence, and occupation/skill taxonomy patterns while
  explicitly rejecting the claim that an AI agent is a person or that a generic benchmark is job
  qualification.
- **Escalated decision:** family placement was resolved by `DI-B11B240AEA8F`; no remaining
  architecture option trade-off was found.
- **Reference-doc feedback:** none. Relevant external standards are now captured directly in the
  normative sources and this plan.

## Verification evidence

- Regenerated TAK, GAID, TAK-JSI, and the governance white paper from the shared publication
  manifest.
- Rendered all `39 + 46 + 24 + 20 = 129` generated Word pages through Microsoft Word and Poppler;
  contact-sheet inspection found no clipped content, broken tables, or missing images. The JSI
  diagram was revised to a compact lifecycle and the generator now embeds PNG as the Office-safe
  primary while retaining SVG publication assets.
- Verified DOCX ZIP integrity and required section text for all four publications.
- `node scripts/gen-doc-index.mjs --check` — pass (`557` pages).
- `node scripts/check-doc-links.mjs` — pass.
- `node --test scripts/check-doc-links.test.mjs` — `16/16` pass.
- `node scripts/render-doc-diagrams.mjs --check` — pass.
- `node --test scripts/check-doc-reference-integrity.test.mjs` — `13/13` pass.
- `node scripts/check-doc-reference-integrity.mjs` — pass, no net-new broken references.
- Generator syntax checks, JSON parsing, stale-term scan, and `git diff --check` — pass.
- UX verification: not applicable; no portal UI or workflow behavior changes.
- Migration verification: not applicable; no schema or migration changes.
