---
status: active
---

# BI-4738F64B — implementation plan locator

The canonical ordered implementation plan is the **Phase 3 integrity patch — BI-4738F64B ordered fix sequence** in [Coworker Capability Routing & Evidence Integrity](../specs/2026-07-17-coworker-capability-routing-evidence-integrity-design.md).

This file is only the backlog-coverage locator. Requirements, invariants, research evidence, implementation order, and verification remain single-sourced in the canonical design.

## Governed traceability

- Requirements: `OBJ-TOOL-CEILING`, `OBJ-SCHEDULED-TRUTH`
- Verification: `AC-TOOL-CEILING-1`, `AC-TOOL-CEILING-2`, `AC-SCHEDULED-TRUTH-1`, `AC-SCHEDULED-TRUTH-2`, `AC-BI473-LIVE`
- Contracts: `INV-3a`, `INV-7`
- Flows: `load_tools recompilation`, `scheduled task terminal classification`
