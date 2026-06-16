# SysML v2 Reference

Last checked: 2026-06-14

This reference pins the DPF architecture baseline for SysML v2 adoption. It is
not a tool endorsement and does not approve any external runtime, package, MCP
server, or hosted modeling service. External tools still go through the DPF Tool
Evaluation Pipeline before adoption.

## Official specification stack

| Standard | Current version | OMG status | DPF use |
| --- | --- | --- | --- |
| [OMG System Modeling Language](https://www.omg.org/spec/SysML/2.0/About-SysML) | SysML 2.0 | Formal, September 2025 | Internal systems-architecture notation for requirements, structure, behavior, analysis cases, verification cases, interfaces, allocations, and traceability. |
| [Kernel Modeling Language](https://www.omg.org/spec/KerML/1.0/About-KerML) | KerML 1.0 | Formal, September 2025 | Semantic foundation behind SysML v2 concepts. Use when designing the DPF ontology mapping, not as a user-facing notation. |
| [Systems Modeling API and Services](https://www.omg.org/spec/SystemsModelingAPI/1.0/About-SystemsModelingAPI) | Systems Modeling API 1.0 | Formal, September 2025 | Future adapter boundary for import/export or tool interoperability after tool evaluation. |

OMG lists the SysML 2.0 normative language document as `formal/26-03-02`, the
SysML transformation document as `formal/26-03-03`, KerML 1.0 as
`formal/26-03-01`, and Systems Modeling API 1.0 as `formal/26-03-04`.

## DPF stance

SysML v2 is an internal architecture and agent-reasoning standard for DPF. It is
for architects, Build Studio planning/review, data architecture stewardship,
advanced reseller/partner review, and external coding agents working on platform
architecture.

SysML v2 is not the default end-user modeling experience. Normal users continue
to see work outcomes, simple architecture explanations, and progressive
disclosure. SysML detail is exposed through EA to users with architecture access.

## Relationship to existing DPF notations

| Notation/viewpoint | Role in DPF |
| --- | --- |
| ArchiMate | Default enterprise architecture and capability notation. |
| BPMN | Process/workflow behavior, especially value-stream execution and human/agent work. |
| C4 | Human-readable software architecture views and onboarding diagrams. |
| SysML v2 | Internal systems architecture substrate: requirements, constraints, interfaces, allocations, behavior, verification, and traceability. |

DPF's canonical source remains the platform substrate: Postgres system-of-record,
EA graph models, code graph, governed evidence, and mirrored runtime facts.
SysML v2 should be a notation/viewpoint over that substrate, not a parallel
directory of hand-maintained model files.

## DPF implementation standard

Use SysML v2 with the Design-Implementation Parity Engine:

- Derive current-state SysML/BPMN views from source registries, manifests,
  schema, code graph, and state machines whenever those sources exist.
- Use hand-authored SysML only for target-state architecture, bounded architect
  judgment, or explicitly tracked gaps.
- Surface drift and unavailable projections through `EaConformanceIssue`; do
  not silently overwrite or ignore model/implementation mismatch.
- Keep external `.sysml` import/export behind the Tool Evaluation Pipeline and a
  governed adapter boundary.

## External tool references

Tool references are research inputs only:

- [OMG SysML v2 tools list](https://www.omg.org/sysml/sysmlv2/sysml-tool/) -
  informational list, not an OMG endorsement.
- [Eclipse SysON](https://mbse-syson.org/) and
  [eclipse-syson/syson](https://github.com/eclipse-syson/syson) - open-source
  web-based SysML v2 modeling.
- [Systems-Modeling SysML v2 Pilot Implementation](https://github.com/Systems-Modeling/SysML-v2-Pilot-Implementation) -
  reference/pilot implementation for SysML v2 textual notation, visualization,
  and interchange work.
- [Syside Editor / sysml-2ls](https://github.com/sensmetry/sysml-2ls) -
  textual SysML v2 language support lineage for developer-style workflows.
- [CATIA Magic SysML v2](https://www.3ds.com/products/catia/catia-magic),
  [Sparx Systems Trechoro](https://sparxsystems.com/mbse/sysml2/), and
  [Visual Paradigm SysML v2 Studio](https://www.visual-paradigm.com/features/sysml-v2-studio/)
  are commercial benchmarking references, not approved DPF dependencies.
