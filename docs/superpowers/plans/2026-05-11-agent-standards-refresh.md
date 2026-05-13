# Agent Standards Refresh Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the `TAK`, `GAID`, white paper, and conformance documents so they are more implementable, better grounded in adjacent standards and market research, and clearer about `DPF` as the initial prototype implementation.

**Architecture:** Keep the existing document structure and strengthen it in place rather than rewriting from scratch. Add the missing normative content where it belongs, add new neutral diagrams and public-verification architecture diagrams with simpler layouts for readability, then regenerate the `.docx` outputs from the Markdown sources of truth.

**Tech Stack:** Markdown, Mermaid, Node.js doc-generation pipeline, `docx`, official standards and vendor references

---

## Chunk 1: Planning and Source Updates

### Task 1: Refresh `TAK`

**Files:**
- Modify: `docs/architecture/trusted-ai-kernel.md`

- [x] Add a neutral `TAK` reference-model diagram focused on the standards view rather than any one vendor.
- [x] Add a normative dependency/profile matrix for reused standards such as `MCP`, `A2A`, `Trace Context`, and `HTTP Message Signatures`.
- [x] Add more implementable runtime content: pseudocode, queue/backpressure/failover examples, and machine-readable JSON event examples.
- [x] Add language clarifying what is implementable now versus what is future-state profile material.

### Task 2: Refresh `GAID`

**Files:**
- Modify: `docs/architecture/GAID.md`

- [x] Strengthen internal versus public identity sections, including `LDAP` / `SCIM` / enterprise directory posture.
- [x] Expand `AIDoc` requirements with identity/accountability, directory binding, entitlement, blast-radius, and interoperability fields.
- [x] Upgrade badge requirements to a layered badge model with applicability scope, evidence model, assurance levels, and archetype/workflow scrutiny.
- [x] Add public verification architecture options, tradeoffs, staged adoption, governance dependencies, economics, and open ecosystem questions.
- [x] Add machine-readable JSON examples and pseudocode where they materially improve implementability.

### Task 3: Refresh the White Paper and Prototype Story

**Files:**
- Modify: `docs/architecture/2026-04-18-trusted-ai-agent-governance-white-paper.md`
- Modify: `docs/architecture/agent-standards-dpf-conformance.md`

- [x] Add the neutral standards model and the staged adoption rationale based on prior art such as `ISBN`, `DNS`, and public PKI.
- [x] Strengthen the market/policy sections with the current reference set and the balanced treatment of `ServiceNow`, `Microsoft`, `Veza`, and adjacent identity work.
- [x] Position `DPF` explicitly as the initial implementation prototype and identify what the standards require the prototype to add next.
- [x] Update the conformance document so the missing `GAID` pieces become an explicit implementation outcome list.

## Chunk 2: Diagram and Publication Work

### Task 4: Improve Diagram Readability

**Files:**
- Modify: `docs/architecture/tak-diagrams/*.mmd`
- Modify: `docs/architecture/gaid-diagrams/*.mmd`
- Modify: `docs/architecture/tak-diagrams/mermaid-config.json`
- Modify: `docs/architecture/gaid-diagrams/mermaid-config.json`
- Modify if needed: `docs/architecture/generate-docx-from-markdown.mjs`

- [x] Add at least one new neutral `TAK` diagram and one new public `GAID` verification architecture diagram.
- [x] Simplify dense node labels, prefer darker text on lighter fills, and raise baseline font sizing where it improves Word readability.
- [x] Keep diagrams vendor-neutral in the standards and use vendor mappings only as informative overlays.
- [x] Adjust the doc-generation path only if the current SVG/PNG handling still constrains legibility.

### Task 5: Regenerate and Verify Publication Outputs

**Files:**
- Generate: `docs/architecture/Trusted-AI-Kernel-Architecture.docx`
- Generate: `docs/architecture/GAID.docx`
- Generate: `docs/architecture/Trusted-AI-Agent-Governance-White-Paper.docx`

- [x] Run the standards document generation scripts.
- [x] Verify generated outputs for diagram readability and layout quality.
- [x] Record any remaining fidelity gaps or implementation gaps that should stay visible as future work.

## Chunk 3: Verification and Wrap-Up

### Task 6: Final Verification

**Files:**
- Review: `docs/architecture/trusted-ai-kernel.md`
- Review: `docs/architecture/GAID.md`
- Review: `docs/architecture/2026-04-18-trusted-ai-agent-governance-white-paper.md`
- Review: `docs/architecture/agent-standards-dpf-conformance.md`

- [x] Check for internal consistency between `TAK`, `GAID`, the white paper, and the conformance assessment.
- [x] Confirm the references use real, verifiable external sources wherever possible.
- [x] Confirm `DPF` is described as a prototype and proving ground, not as a fully complete conformance claim.
- [x] Summarize what is now implemented in the documents and what remains to be built in the platform itself.

## Verification Notes

- `node docs/architecture/generate-tak-docx.mjs`
- `node docs/architecture/generate-gaid-docx.mjs`
- `node docs/architecture/generate-agent-standards-white-paper-docx.mjs`
- `git diff --check`

In the rescue worktree, Mermaid CLI was available by prepending the root clone's `node_modules/.bin` to `PATH`; the generated SVG/DOCX outputs were refreshed, while the recovered PNG assets for the two new diagrams remained available for DOCX embedding.
