---
title: Governed document lifecycle repair
status: draft
backlogItem: BI-A2A71149
---

# Governed document lifecycle repair

## Scope and authority

The operator requested full implementation and refactoring of existing document
handling on 2026-10-02. This work repairs the existing pipeline; it introduces no
document database, approval authority, queue, or exemption from independent review.
The integration/offline recovery request remains open in BI-02E5CE5A and BI-7A4E70E9.

Original source inspected: `0ada52b55865140f5e5c0bab01eec4ad33ea4fdb`.
Reconciled source base: `5c7e1f3c1c9b179bb0d22bccb03ea6fa0e182c3c`. The checkpoint below supersedes
the original delivery-state descriptions; the contracts remain proposed acceptance.
The first delivery unblocks documentation evidence. Subsequent deliveries repair
scope validation and immutable review inputs, then prove their joined lifecycle.
Implementation and runtime acceptance are not established by this draft.

## Existing contracts and confirmed defects

| Boundary | Existing owner | Confirmed gap |
| --- | --- | --- |
| Immutable document bytes | Initiative artifact resolver and repo-blob-at-commit / document-version / feature-build-revision references | Every consumer must retain the same source reference and digest; an unrelated runtime checkout is not the submitted revision. |
| Objective and acceptance projection | `apps/web/lib/backlog/initiative-readiness/baseline-manifest.ts` | The strict marked-statement grammar is only discovered at baseline creation; validate before review. Table parsing and rendering must preserve complete statements. |
| Structured design rendering | `render-build-design-text.ts` in the same directory | Reuse its deterministic projection; do not persist a second editable Markdown copy. |
| Independent review | `apps/web/lib/change-review/semantic-change-review.ts`, routed reviewer, existing TaskArtifact and ExternalEvidenceRecord | The prompt permits an unrelated visible tree to displace the supplied patch. BI-AEEEFA15 owns this defect. |
| Review routing | `initiative-readiness/design-phase-recovery.ts` and exact request guard | BI-EE99767C / PR #5984 repairs the issuer/guard mismatch. Consume and verify it. |
| Documentation verification | `scripts/lib/documentation-evidence-lane.mjs` and `local-ci-gate-state.mjs` | The lane records current source/result atomically, but does not identify its own evidence lane to the reader. |
| Status projection | `scripts/lib/pregate-status.mjs` | It requires the heavyweight runner metadata even when documentation verification never ran that runner. A prior candidate then produces STALE after real documentation PASS. |

The last defect is reproduced by evidence `cmurrsp1e0ax601qjkfh4i05e`
and the preserved pregate exit 7 on `165664bb2a298668715b6bdfb8cb9474087f398d`.
BI-B2E9FC9D owns the existing documentation lane. BI-C6B2D404 repaired a related
canonical-reuse producer, but its metadata projection does not cover this lane.

## Objectives and acceptance

- **OBJ-DOC-1:** Validate governed document structure before spending independent review capacity, without losing statement content.
- **OBJ-DOC-2:** Review the exact immutable submitted content and retain findings and receipt identity through retries.
- **OBJ-DOC-3:** Publish and read documentation evidence consistently across earlier code runs, interruption and source changes.
- **OBJ-DOC-4:** Demonstrate the complete approval-to-publication workflow through shared contracts and Codex on the canonical runtime.

| ID | Objectives | Observable acceptance |
| --- | --- | --- |
| AC-DOC-1 | OBJ-DOC-1 | A malformed governed scope is rejected before review with the offending location; a valid external Markdown or structured design yields the same complete objective/acceptance statements at validation and baseline creation. |
| AC-DOC-2 | OBJ-DOC-2 | A stale reviewer checkout cannot replace valid supplied contents; missing, truncated or digest-mismatched input is inconclusive and cannot yield an approval. |
| AC-DOC-3 | OBJ-DOC-3 | A documentation run following a code run reports its own exact-source result, preserves the previous diagnostic files, and never requires heavyweight capacity. |
| AC-DOC-4 | OBJ-DOC-3 | Failure, interrupted write/publication, expired evidence, changed source and forged/malformed lane markers cannot produce a new PASS; a bounded retry preserves canonical evidence history. |
| AC-DOC-5 | OBJ-DOC-2, OBJ-DOC-4 | Duplicate review delivery joins existing work; changed content or policy invalidates reuse; self-review and altered request packets remain refused. |
| AC-DOC-6 | OBJ-DOC-4 | An unpublished document passes validation, receives independent review, mints a baseline, gains coverage and implementation admission, and publishes with matching evidence; the live Codex exercise records the deployed source and receipt chain. |

## Delivery contracts

CON-DOC-1: the existing artifact reference is the identity of source content.
Normalization for statement comparison never changes the artifact digest. The
scope parser remains the sole projection used for early validation and baseline
creation. Do not infer objectives from arbitrary prose or silently skip malformed
marked statements. Ordinary prose documents without a governed-scope role remain
ordinary documentation; they must not acquire mandatory initiative objectives.

CON-DOC-2: semantic review consumes immutable submitted material. Include artifact
kind and bound identity in the review context. A complete patch may establish a
new document in full; when unchanged context is needed, use the existing immutable
artifact readers. Missing context returns inconclusive with the exact missing
reference. Never substitute the currently installed checkout. Review transport,
content validity, design judgment and publication readiness remain distinct facts.

CON-DOC-3: the existing local gate state is the documentation lane's atomic result
record. Extend its contract with an explicit producer/lane binding and sufficient
source/evidence identity. The status reader recognizes only a complete supported
documentation binding, verifies it against current source and terminal state,
then reads this lane's evidence. Heavyweight metadata remains authoritative for
heavyweight execution and retains its mismatch guard. Unknown/malformed bindings
fail closed. No metadata deletion, fabricated build evidence or blanket mismatch
exemption is permitted. The real documentation producer publishes server evidence
before atomically writing the local terminal record.

CON-DOC-4: approval, baseline and coverage writers retain their current ownership,
grant intersection and independence checks. The end-to-end exercise calls the real
issuer and guard, not two agreeing mocks. Reuse existing TaskRun single-flight,
ExternalEvidenceRecord and immutable gate identity. No new retry service.

FLOW-DOC-1: immutable document -> structural validation -> independent content
review -> approved baseline -> plan coverage -> implementation admission.
FLOW-DOC-2: document checks -> recorded server evidence -> atomic local result
-> authoritative publication status. Interrupted transport is unrun/inconclusive;
it cannot rewrite a completed code verdict or create a pass.

## Ordered implementation

1. Documentation evidence repair: extend the existing atomic state contract and
   reader together. Reproduce code-run -> docs-run -> STALE with the real state
   writer and reader, then test malformed bindings, expired evidence, changed
   branch/SHA, failed docs and interruption. Cover the actual documentation lane
   integration and retain its no-heavyweight-admission invariant.
2. Scope validation: refactor the existing parser/renderer into one lossless
   contract used before review and during baseline creation. Add source-local
   validation for external documents and the same server validation at the
   governed review boundary. Verify pipes, multiline input, duplicate identifiers,
   unknown references and ordinary non-governed documents. Update the existing
   template and operating instructions with the actual supported grammar.
3. BI-AEEEFA15: bind reviewer context to immutable supplied content, correct prompt
   precedence and propagate artifact kind. Test routed input with a stale checkout,
   malformed/empty artifacts and incomplete context; perform a live unpublished
   review. Retain real reviewer independence and all receipt freshness checks.
4. Consume BI-EE99767C's merged routing correction. Compose real validation,
   artifact resolution, request issuance/guard, baseline and coverage contracts
   into a regression exercise, including duplicate delivery, interrupted evidence
   publication and negative authorization cases. Run the actual workflow via
   Codex against the canonical deployed runtime and record every stage separately.

Each numbered repair is independently reviewable and may ship separately; the
umbrella closes only after AC-DOC-1 through AC-DOC-6 are verified. Link live child
items and coverage before claiming implementation readiness for the full program.

## Research & Benchmarking

- [GitHub Flavored Markdown](https://github.github.com/gfm/#tables-extension-):
  follow its escaped-pipe table semantics; retain DPF's explicit objective IDs.
  Do not mistake visually rendered prose for a valid scope manifest.
- [JSON Schema](https://json-schema.org/understanding-json-schema/reference/object):
  adopt explicit required/versioned fields and rejection of unsupported shapes.
  Reuse existing validators; add no package or schema registry.
- [SLSA artifact verification](https://slsa.dev/spec/v1.1/verifying-artifacts):
  adopt verification of subject identity and expected producer. Existing DPF
  receipts remain the authority; this work does not claim SLSA certification.

## Verification, risks and rollback

VER-DOC-1: deterministic writer/reader and parser/renderer integration tests,
including negative fixtures and interruption boundaries. These are source-local.
VER-DOC-2: exact-tree canonical CI, independent semantic review and protected PR
checks for each repair. VER-DOC-3: canonical runtime end-to-end Codex exercise;
blocked dependencies are recorded unrun, never accepted as passing coverage.

Main risks are admitting stale evidence, silently changing a baseline statement,
or accepting a review of different content. Negative tests must refute each.
No schema migration is proposed. Existing records remain readable; new fields are
additive and unsupported forms fail closed. Reverting a reader/writer change must
leave source, server receipts and prior diagnostic files intact; rerun verification
when an older reader cannot recognize new evidence. Never rewrite historical
approvals or regenerate their digests to fit changed content.

## Backlog coverage

Umbrella BI-A2A71149; existing children BI-AEEEFA15 and BI-EE99767C.
Documentation metadata is owned by BI-C6B2D404; parser/validation by BI-CFD5A55A; artifact activation by BI-9D6355DF; binding by BI-0A5E19DE. Reuse their delivery evidence without inventing umbrella baseline or coverage. This draft records intended work and is not an implementation receipt.

## Delivery checkpoint — 2026-10-15

This draft is preserved for the next governed document delivery. It has not
received a new approval or created an objective baseline.

| Scope | Owner | Proven state | Remaining acceptance |
| --- | --- | --- | --- |
| Documentation evidence/status | BI-C6B2D404 | PR #5987 merged and deployed through SUR-76634FA3 | Compose with the final full workflow |
| Parser/renderer and pre-review validation | BI-CFD5A55A | PR #6272 merged c538f980 and deployed within 1ace3621; canonical gate cmv6alwa935dl01la66rahoqg passed 5,286 tests, with 26 skipped and 5 todo; 170 focused tests passed; zero newly rejected among 129 accepted designs in a 938-document corpus | Joined live validation and full lifecycle acceptance |
| Artifact-compatible readers | BI-AEEEFA15 | PR #6261 merged at 4a36173f and deployed; 7,221 canonical tests passed; exact-source native review TR-GATE-357E568ADCCFFA161E94B64A returned PASS with no issues | Compose with activation and document-role live acceptance |
| Role-bound writer and publication expectation | BI-9D6355DF | PR #6334 merged at 57f1adff2687010d3b3bddf7b3a3e589a0c46217 and canonically deployed through SUR-C3F29A72; 5,151 canonical tests, 213 focused Vitest and 13 Node tests passed | Live artifact-role verdict and joined lifecycle acceptance remain unrun |
| Source/workroom/evidence consistency | BI-0A5E19DE | PR #6371 merged at ebbf5eeb9686d972245a3a6bd7c43dd4f0b4a63b; canonical 4,230 tests and genuine native independent review passed | Canonical deployment and live valid/invalid admission acceptance |
| Full canonical Codex workflow | BI-A2A71149 | Not run | Validation, independent review, baseline, coverage, implementation admission and publication with matching immutable identities |

The compatible-reader stage deliberately leaves production writers unchanged.
The expected role for publication must come from the publication request,
independently of the receipt being checked. Legacy requests retain their original
contract and retry budgets; historical receipts are never rewritten or rebound.

New scope validation applies only to a newly authorized spec-approval request.
Consent, grants, human authority, room access and exact issued request are checked
before protected bytes are resolved. Matching durable work joins without provider
re-fetch. Missing source, digest mismatch or invalid UTF-8 cannot produce a review
verdict. Ordinary reference tables mentioning AC identifiers are not governed
scope; recognized acceptance tables still validate every marked row.

Native review infrastructure remains a delivery dependency. The deadline repair
PR #6262 and the canonical release path must be verified before new native review
execution. Client assessments and passing unit tests are recorded separately and
cannot mint independent initiative-baseline approval.

## Continuation and acceptance execution

The supported handoff of WC-0AB5A73C to the current Codex session executed on
2026-10-15. The prior independent baseline attempt
TR-MCP-b2F1dGgtZmFtaWx5OmNiYzdiMGRkLTkxMDQtNDVkZS05NTdkLThmMmQ4ZjY3MDJmMQ-9F571D763FE0
has failed immutable-reader evidence and no baseline. Preserve that task and its
refused recovery. The scheduled spec-stage dispatch also lacks a completing
writeback. Neither fact permits blind redispatch or synthetic approval.

Before a new review of this revised artifact, bind its exact full commit and
canonical path, refresh readiness, and consume only a server-issued reviewer
packet for that content. A routing refusal remains blocked; record its request
and result without changing reviewer identity or constructing a packet by hand.
The design author may record research, never their own independent approval.

After independent scope approval, record a plan mapping AC-DOC-1 through AC-DOC-6
to the existing owners above and the umbrella acceptance exercise. The exercise
uses a real unpublished immutable document and real routed validation, review,
baseline, coverage, admission and publication. Record source reference/digest,
request identity, reviewer principal, receipt IDs, baseline ID, coverage ID,
admission decision and final publication identity at each boundary. Acceptance
includes malformed scope, stale checkout, changed bytes/policy, self-review,
duplicate delivery, lost transport and interrupted publication. A missing stage
leaves the chain incomplete; a source test alone cannot establish live success.

Current runtime is still c4b60a729b7d58c433e34abbb607395060d032f1 following failed
upgrade SUR-5B92E384. Migration repair is separately owned under BI-BF20F828.
Canonical deployment and live acceptance of PR #6371 remain dependencies.
Integration and offline recovery remain separately open; this document does not
claim their failure exercises or independent recovery executor complete.
