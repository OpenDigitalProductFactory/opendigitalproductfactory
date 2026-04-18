# TAK + GAID Standards Family Design

| Field | Value |
|-------|-------|
| **Status** | Draft for review |
| **Created** | 2026-04-18 |
| **Author** | Codex + Mark Bodman |
| **Primary Audience** | Governments, standards bodies, enterprise buyers, AI platform builders |
| **Document Set** | `TAK` normative standard, `GAID` normative standard, supporting white paper |

## Purpose

This design defines a standards-family effort built from two peer normative standards and one advocacy white paper:

1. `TAK` — a runtime governance standard for trustworthy AI agent operation.
2. `GAID` — a global identity, provenance, and badging standard for AI agents.
3. `White paper` — a market, policy, and implementation paper that explains the need for both standards, cites current public activity, and uses DPF as a practical proving ground.

The intent is to move beyond fragmented AI governance artifacts and propose a pragmatic, globally relevant, and implementable approach that can be exercised on the DPF platform and positioned for submission to governments and standards bodies.

## Problem Statement

The current AI governance landscape is fragmented across:

- Organization-level management standards such as `ISO/IEC 42001`
- Risk frameworks such as `NIST AI RMF`
- Interoperability protocols such as `MCP` and `A2A`
- Supply-chain and provenance standards such as `SLSA`, `SPDX`, `in-toto`, and `C2PA`
- Identity, signature, and trace standards such as `W3C Verifiable Credentials`, `W3C Trace Context`, and `RFC 9421 HTTP Message Signatures`
- Vendor-specific artifacts such as model cards, system cards, safety hubs, prompt controls, and tool descriptors

These are all useful, but none of them fully answer the combined operational question:

> How do we identify, attest, govern, constrain, observe, verify, and audit AI agents operating across organizations and tool surfaces at scale?

The absence of a unified answer creates pain in several areas:

- Enterprises struggle to inventory and manage agents consistently
- Agent tool, skill, and prompt surfaces are hard to compare and trust
- Public and cross-boundary agents lack consistent global identity and accountability
- Runtime enforcement and external identity are rarely connected
- Human-in-the-loop policies, memory behavior, and hidden instructions are not consistently disclosed or auditable
- Current standards do not adequately unify identity, authorization classes, badging, provenance, and runtime chain-of-custody

## Design Goals

The standards family must:

1. Provide normative language using `MUST`, `SHOULD`, and `MAY`.
2. Separate external identity and badging concerns from runtime enforcement concerns.
3. Keep `TAK` and `GAID` independently evolvable while making them cross-referential.
4. Support both private enterprise agents and public B2B/B2C agents.
5. Include conformance language and testability.
6. Be grounded in current emerging standards and public policy activity.
7. Be practical enough to test against DPF immediately.
8. Be strong enough to support future submission to governments and standards bodies.

## Recommended Document Set

### 1. TAK Normative Standard

`TAK` is the runtime governance standard.

It defines how a platform constrains and supervises agent behavior at runtime. It is concerned with operational trust and control, not global naming.

Core topics:

- authority and role mediation
- local authorization and policy enforcement
- immutable directives and hidden instruction governance
- tool mediation and execution modes
- HITL tiers and approval requirements
- delegation narrowing
- logging, non-repudiation, and evidence retention
- memory retention and context-window controls
- sensitivity and data handling controls
- runtime transparency and activity exposure
- anti-fabrication and anti-hallucination controls
- specialist and coordinator agent topology
- evaluation, red teaming, and conformance

### 2. GAID Normative Standard

`GAID` is the global identity, provenance, and badging standard.

It defines how an agent is named, attested, described, validated, and traced across organizational boundaries. It includes identity, public/private scoping, assurance claims, and custody metadata.

Core topics:

- public and private namespace model
- global registry and delegated prefix governance
- accredited issuers and certificate-backed validation
- agent identity document and resolver model
- badging taxonomy for capabilities, governance posture, assurance, and fit-for-purpose
- authorization classes as portable policy declarations
- model, tool, prompt, and skill surface declarations
- provenance, signing, receipts, and transparency logging
- chain-of-custody across delegation and tool calls
- self-asserted, org-attested, and independently certified assurance levels
- revocation, key rotation, and badge expiration
- protocol compatibility profiles for `MCP`, `A2A`, HTTP, queues, and related transports

### 3. Supporting White Paper

The white paper is the persuasion and context document.

It explains:

- why the market needs both standards
- why existing standards and protocols remain fragmented
- where public policy and frontier AI vendor activity indicate demand
- what DPF demonstrates in practice today
- how a standards-family approach can support government, enterprise, and ecosystem adoption

It is not itself the normative source of requirements.

## Why Two Standards Instead of One

The standards must remain separate because they solve distinct problems:

- `GAID` addresses global identity, trust signaling, provenance, validation, and cross-boundary accountability.
- `TAK` addresses local runtime control, governance enforcement, human oversight, and operational safety.

This separation mirrors other mature ecosystems:

- DNS and ISBN distinguish identifier structure from delegated governance operations.
- PKI distinguishes certificate identity and trust anchors from application-level authorization.
- IAM distinguishes identity from runtime policy decisions.

The standards will still reference each other directly:

- `TAK` should define how runtimes consume and enforce `GAID` metadata.
- `GAID` should define how identity, badging, and receipts can express expectations that a `TAK` implementation enforces locally.

## Normative Structure

Both standards should use a consistent normative layout:

1. Scope
2. Conformance
3. Normative references
4. Terms and definitions
5. Design principles
6. Core data model
7. Required controls or behaviors
8. Profiles and assurance levels
9. Security and privacy considerations
10. Interoperability considerations
11. Conformance testing guidance
12. Informative annexes

## TAK Draft Direction

The revised `TAK` should elevate from architecture description to a normative runtime control standard.

New or strengthened sections should include:

- runtime authority model
- required tool execution classes
- mandatory audit events
- required human approval triggers
- requirements for immutable instruction handling
- requirements for disclosure of hidden governance directives
- requirements for memory and context handling
- requirements for route or domain scoping
- requirements for delegation boundaries
- anti-fabrication and anti-narration runtime controls
- minimum evaluation and red-teaming expectations
- conformance levels such as `TAK-Basic`, `TAK-Managed`, `TAK-Assured`

## GAID Draft Direction

The revised `GAID` should expand from identifier proposal to a normative identity and badging standard.

New or strengthened sections should include:

- GAID syntax and namespace governance
- public vs private GAID allocation
- issuer roles and accreditation
- agent identity document schema
- badge schema and trust assertions
- authorization class taxonomy
- external certificate model
- signed action receipt model
- chain-of-custody model
- transparency log obligations
- trust and assurance levels
- public verification requirements
- conformance levels such as `GAID-Private`, `GAID-Public`, `GAID-Assured`

## White Paper Direction

The white paper should contain:

1. Executive summary
2. The market problem
3. Why current approaches are fragmented
4. Evidence from public standards and policy activity
5. Evidence from enterprise operating pain
6. Why `TAK` and `GAID` together close the gap
7. DPF as a proving ground
8. Proposed roadmap for ecosystem adoption
9. Submission and engagement options for governments and standards bodies

## Required Research Inputs

The standards and white paper must reference and compare against current public work including:

- `NIST AI Agent Standards Initiative`
- `NCCoE` software and AI agent identity and authorization concept paper
- `NIST AI 800-2` benchmark evaluation work
- `NIST AI RMF` and related profiles
- `ISO/IEC 42001`
- `ISO/IEC JTC 1/SC 42`
- `MCP`
- `A2A`
- `OpenTelemetry` and `W3C Trace Context`
- `RFC 9421 HTTP Message Signatures`
- `SLSA`, `SPDX`, `in-toto`, `SCITT`, `C2PA`
- `W3C Verifiable Credentials`
- relevant `OWASP` guidance for LLM and agent risks
- public policy and standards engagement by `OpenAI`, `Anthropic`, and other major vendors

## DPF Conformance Strategy

DPF should be used as the first implementation case study and preliminary conformance target.

The assessment should classify items as:

- implemented
- partially implemented
- not implemented
- not yet assessable

### DPF Against TAK

Likely assessment areas:

- authority mediation
- role and grant intersection
- execution mode enforcement
- HITL gating
- system prompt composition
- immutable directive handling
- anti-fabrication controls
- audit logging
- route-scoped agent context
- model routing and phase controls
- memory and handoff controls
- runtime observability

### DPF Against GAID

Likely assessment areas:

- internal agent identifiers
- authorization class declarations
- capability and tool metadata
- evidence of provenance and receipts
- public/private identity separation
- externally verifiable identity documents
- issuer and certificate model
- badge model
- cross-boundary traceability

## Implementation Plan for the Document Work

### Phase 1: Source Modernization

- retain `TAK` in Markdown as the source of truth
- convert `GAID` from `.docx` to Markdown source of truth
- keep `.docx` generation as an output path, not the primary editing surface

### Phase 2: Standards Rewriting

- rewrite `TAK` as a normative standard
- rewrite `GAID` as a normative standard
- align terminology and cross-references

### Phase 3: White Paper

- create a new white paper grounded in current public evidence
- cite policy activity and standards work with dates and source links
- explain how DPF exercises the theory in practice

### Phase 4: Conformance Appendix

- assess DPF against both standards
- record current strengths, gaps, and recommended next steps

## Risks

### Risk: Overreach

If the documents try to standardize every adjacent issue at once, they will become unreadable and hard to adopt.

Mitigation:
- keep `TAK` focused on runtime governance
- keep `GAID` focused on identity, provenance, badging, and custody
- use the white paper to discuss broader ecosystem implications

### Risk: Standards Drift

Emerging protocols and policy work are moving quickly.

Mitigation:
- treat the first publication as `Version 0.x`
- include a clear evolution model
- ground the normative core in durable patterns, not vendor-specific transient details

### Risk: Weak Practicality

If the standards are not tested against a real platform, they may read as abstract theory.

Mitigation:
- use DPF as the first conformance test bed
- include evidence-backed examples
- distinguish between aspirational requirements and currently implemented behaviors

## Recommendation

Proceed with:

1. revising `TAK` into a standalone normative runtime governance standard
2. revising `GAID` into a standalone normative identity, provenance, and badging standard
3. creating a new white paper that justifies both standards and cites current market and policy activity
4. using DPF as the first practical conformance target and case study

## Expected Output Files

- `docs/architecture/trusted-ai-kernel.md` revised
- `docs/architecture/GAID.md` created as the new editable source
- `docs/architecture/GAID.docx` regenerated or replaced from the Markdown source
- `docs/architecture/<white-paper-filename>.md` created
- optional generated `.docx` outputs for the standards and white paper

## Review Ask

This spec proposes a three-document standards package:

- two peer normative standards (`TAK`, `GAID`)
- one supporting white paper

It also proposes migrating `GAID` to Markdown as the editable source of truth and assessing DPF against both standards as the first conformance case.
