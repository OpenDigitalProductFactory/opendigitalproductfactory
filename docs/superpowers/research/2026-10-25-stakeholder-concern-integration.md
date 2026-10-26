---
title: Stakeholder concern integration research
date: 2026-10-25
status: draft
backlogItem: BI-FECE4497
---

# Stakeholder concern integration research

This research supports the [integration design](../specs/2026-10-25-stakeholder-concern-integration-design.md). It compares mechanisms, not products to install. No dependency, service, paid subscription, or regulatory obligation is adopted by this document.

## Question

How can DPF connect stakeholder-specific consequences to scoped doctrine, competent process coverage, action safeguards, and feedback without requiring the operator to remember every concern?

## Research & Benchmarking

Sources were inspected on 2026-10-25. Product documentation describes intended mechanisms; it is not evidence that DPF implements them.

### Open-source comparators

| Comparator | Data and control mechanism inspected | Adopt | Reject or limit |
| --- | --- | --- | --- |
| [Open Policy Agent](https://www.openpolicyagent.org/docs/policy-language) and [decision logs](https://www.openpolicyagent.org/docs/management-decision-logs) | Structured input and data produce a decision result. Logs retain input/result and policy-bundle context; masking can remove sensitive fields. Undefined input and evaluation errors require deliberate handling. | Explicit evaluation input, named missingness, reproducible policy context, privacy-conscious decision references. | A second policy service, remote log store, and treating undefined as a harmless zero. DPF already owns decision and authority boundaries. |
| [Cedar](https://docs.cedarpolicy.com/auth/authorization.html) | Principal/action/resource/context requests, permit and forbid policies, determining-policy diagnostics. A satisfied forbid overrides permit; policies that error are skipped by the base algorithm. | Exact action/target context, vetoes that a favorable aggregate cannot outweigh, attributable reasons. | Replacing DPF's authority model. DPF must not skip an errored mandatory safeguard and call the result assured. |
| [BMAD Method](https://docs.bmad-method.org/) and the [existing DPF evaluation](../../security/tool-evaluations/2026-09-15-bmad-method.md) | Sized planning paths and explicit context/artifact handoffs across specialist roles. DPF's prior evaluation identifies file-based project artifacts and client-side workflows. | Proportionate process and explicit context handoffs; specialists must see the same relevant assumptions. | Installing a competing workflow or treating persona prompts and prose findings as enforceable controls. Existing Workrooms and typed receipts remain authoritative. |

### Commercial comparators

| Comparator | Data and control mechanism inspected | Adopt | Reject or limit |
| --- | --- | --- | --- |
| [IBM OpenPages object model](https://www.ibm.com/docs/en/openpages/9.1.x?topic=types-object-type-descriptions) | Requirements relate to mandates; controls can be evaluated against requirements; requirement versions preserve temporal context; regulatory events/changes/tasks connect changed sources with affected objects. | Distinguish source, requirement, control design, operating effectiveness and change response. Preserve historical versions. | Replicating a separate GRC object hierarchy inside each DPF profession or Workroom. |
| [ServiceNow IRM entity relationships](https://www.servicenow.com/docs/r/governance-risk-compliance/grc-common-functions/relate-profiles-to-each-other.html) | Upstream/downstream entity relationships express how risks and controls affect enterprise context. | Follow affected dependencies beyond the immediate actor and avoid treating each risk as isolated. | Adding a parallel enterprise entity registry. DPF's Organization, Principal, assets and existing references provide identity. |
| [Camunda business rule tasks](https://docs.camunda.io/docs/components/modeler/bpmn/business-rule-tasks/) | A process task calls a decision, maps inputs/results and handles failed evaluation as an incident; binding types distinguish latest, deployment and version-tag selection. | Explicit process-to-decision boundaries and version binding. Record the source/context used for each attempt. | A second workflow runtime or unpinned latest-policy selection presented as reproducible historical execution. |

### Standards

- [NIST AI RMF Playbook MAP](https://airc.nist.gov/airmf-resources/playbook/map/): context, interdisciplinary perspectives, and potentially beneficial/harmful effects inform impact assessment. DPF uses this as an assessment framework, not a universal legal mandate. The page states the framework is being updated; adopted versions must be recorded.
- [W3C PROV-DM](https://www.w3.org/TR/prov-dm/): entities, activities, responsible agents and derivations provide the provenance vocabulary. Map these onto DPF records and references; do not introduce a second graph datastore.
- Existing DPF [scope ownership doctrine](../../founder-kernel/wiki/principles/decisions-belong-to-their-scope.md), [enforceable boundaries](../../founder-kernel/wiki/principles/prose-is-not-a-control-gate.md) and [server-owned guarantees](../../founder-kernel/wiki/principles/platform-function-never-depends-on-a-client.md) govern implementation.

## Source substrate review

Inspected source baseline: f0fe6b72e412c01468a4e0641f3d1dde63b951e6 on main. The source graph also returns existing workforce-specific concern derivation; an empty generic concern lookup would not prove absence.

| Existing carrier | What it supplies | Specific gap for this requirement |
| --- | --- | --- |
| DecisionInteraction and decision-perspective/types.ts | Scoped profile version, options, scored features, subject, evidence, outcome and optional seal. | No first-class assessment-version relationship. DecisionSubjectKind currently contains only backlog_item; do not pretend workroom is already an allowed subject kind. |
| Document / DocumentVersion / DocumentReference | Organization-owned, versioned content, blob digests, source-version relationships and external references. | Existing external references lack a target-version digest and indexed dependency classification suitable for bounded source-change fanout. Extend these carriers. |
| RiskAssessment / RiskControl | Hazard, likelihood, inherent/residual risk and control association. | Risk-only records do not represent per-alternative positive benefits or separately sourced sentiment; do not relabel all impacts as hazards. |
| Regulation / Obligation / Control / ControlObligationLink | Source applicability, versions, retention minimums and reusable control mapping. | A control catalog entry is not evidence it executed for this target/attempt. |
| Workroom / workroom-shape-conformance.ts | Persisted participants, process shape/version and declared-versus-observed conformance. | Correctly following a declared shape does not establish that the shape covers applicable concerns. |
| EvidenceBundle / EvidenceSource | Deliberation-run evidence and structured locators. | Mandatory deliberationRunId makes this an unsuitable universal assessment ledger. Reuse locator conventions, not fictitious deliberation runs. |
| decision/decision-chain.ts | Hashes question, option IDs, criteria, evidence digests and result. | Current seal payload does not automatically cover an assessment document pointer or its source-context digest. Version the seal explicitly. |
| mcp-governed-execute-preflight.ts and policy-action authority | Existing deterministic preflight and action authorization paths. | This review does not prove all sensitive actions have complete preconditions; integrate through their current owners. |
| WorkroomRelation and WikiPageLink | Room-to-room and page-to-page relationships. | Their fixed endpoints cannot honestly represent arbitrary decision-to-regulation dependencies. DocumentReference can, with typed resolver validation. |

## Approach comparison

1. Prompt-only assessment: fastest to introduce, but omitted parties and stale assumptions can remain invisible; there is no durable execution binding.
2. Shared versioned assessment using managed documents and existing decision/Workroom/authority seams: chosen design direction. Adds explicit dependency fields and relationships rather than an engine or stakeholder directory.
3. Independent stakeholder graph and scoring service: supports richer simulation, but duplicates identity, evidence, policy and process systems before their insufficiency has been demonstrated.

The earlier architecture consultation preferred shared assessment, but used qualitative input estimates. It is not an empirical safety result or an implementation approval. Re-evaluate material design changes after independent review.

## What this research does not establish

No current regulation is declared applicable to a particular customer. No live deletion, credit adjudication, new autonomy, or provider change was performed. No claim of exhaustive stakeholder discovery, compliance certification or perfect prevention follows from the compared mechanisms. Proposed thresholds, rollout classes and data changes require the owning reviews and live backlog coverage.
