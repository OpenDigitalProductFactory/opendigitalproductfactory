---
status: active
backlog_item: BI-AF6DDF01
workroom: WC-8A42FBA2
---

# Reconcile streaming capability for interactive routing

Backlog: BI-AF6DDF01. Corrective follow-up to BI-038AA4BC.

**OBJ-STREAM:** Admit subscription text models when existing transport evidence supports streaming and discovery left the model field unknown, preserving explicit refusals and all other routing gates.

## Evidence and existing design

On live source `4718cd4f1c5418ab2eba819dd47d5cb839f8eca0`, the COO's human-approved ChatGPT/GPT-6.1-sol preference survived a settings reload. The fresh 2026-10-29 23:31:15 UTC request recorded decision `cmvu6g2n42cqj01o2bnpfko06`: zero preferences applied, two unavailable. Its candidate table in `/platform/audit/routes` names `Missing required capability: streaming` for the GPT subscription candidates. The fallback Claude execution returned an unsettled result; it has not been replayed.

The exact-account recheck authorized by the owner (`cmvu6kveb2d2u01o28enklwuo`) completed once at 23:35:27 UTC with `Connected via OAuth — Responses API verified`. This verifies that probe's streamed Responses completion, not normal coworker acceptance or removal of shared quota holds.

`loader.ts` carries provider `supportsStreaming` independently from model `capabilities.streaming`; `pipeline-v2.ts` checks only the latter. `request-contract.ts` requires streaming by default for synchronous text conversations. The existing resolved tool-use projection already reconciles transport and model evidence. Extend that projection boundary for streaming rather than weakening the request contract or editing live profiles.

BI-7F2FBDA3 covers learned authentication/model eligibility and is delivered; BI-AA618693 fixes a rejected seeded model and is delivered. BI-BCF2D19B covers catalog presence/refresh lifecycle. BI-8F6B15EA covers undated capacity holds. This correction concerns the streaming projection, not those mechanisms.

## Ordered repair

1. Reproduce the interactive exclusion through the real loader and hard filter with provider streaming true and model streaming absent/null.
2. Resolve text-model streaming at the loader boundary: explicit provider false wins; explicit model false remains false; explicit model true remains true unless the provider refuses; otherwise use the provider declaration for general text model classes only. Unknown remains unknown without positive transport evidence. Both the legacy Boolean and ModelCard capability use this resolution, with the Boolean true only for confirmed support. Preserve all unrelated capability fields.
3. Exercise explicit refusals, unknowns, model classes, alternate providers and enable-candidate preview parity. Run impacted tests and typecheck.
4. Publish with the normal exact-tree gate, protected review and canonical upgrade. Verify a fresh read-only coworker request only after the existing unsettled execution is reconciled. A real remaining quota, quality or policy exclusion remains a blocker and must be named.

| Acceptance | Objective | Statement |
| --- | --- | --- |
| AC-STREAM-1 | OBJ-STREAM | A provider-supported text model with unknown model streaming is not excluded solely for streaming. |
| AC-STREAM-2 | OBJ-STREAM | Explicit provider/model streaming refusals remain effective and non-text models do not gain text streaming support. |
| AC-STREAM-3 | OBJ-STREAM | Existing quota, quality, context, privacy and tool gates remain effective; live acceptance is reported separately from source tests. |

## Risks and rollback

Provider metadata can be inaccurate. Model-level false therefore remains authoritative, no unknown transport is promoted to true, and this change does not modify persisted capability evidence. Rollback is the reviewed source revert. No credential, permission, account, quota or schema changes are part of this repair.
