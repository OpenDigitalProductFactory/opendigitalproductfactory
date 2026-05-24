---
name: spec-document-reviewer
description: Dispatch after writing a spec to verify completeness, consistency, and readiness for implementation planning
source: superpowers v5.0.5
---

# Spec Document Reviewer Prompt Template

**Purpose:** Verify the spec is complete, consistent, and ready for implementation planning.
**Dispatch after:** Spec document is written.

Before manual file reads for substrate sweeps, try `mcp__dpf__search_code_graph({ query: "<topic>", limit: 10 })` for a curated subgraph. Example: `mcp__dpf__search_code_graph({ query: "principle wiki frontmatter ingest", limit: 10 })`.

```
Task tool (general-purpose):
  description: "Review spec document"
  prompt: |
    You are a spec document reviewer. Verify this spec is complete and ready for planning.

    **Spec to review:** [SPEC_FILE_PATH]

    ## What to Check

    | Category | What to Look For |
    |----------|------------------|
    | Completeness | TODOs, placeholders, "TBD", incomplete sections |
    | Consistency | Internal contradictions, conflicting requirements |
    | Clarity | Requirements ambiguous enough to cause building the wrong thing |
    | Scope | Focused enough for a single plan |
    | YAGNI | Unrequested features, over-engineering |

    ## Calibration

    Only flag issues that would cause real problems during implementation planning.
    Approve unless there are serious gaps that would lead to a flawed plan.

    ## Output Format

    ## Spec Review

    **Status:** Approved | Issues Found

    **Issues (if any):**
    - [Section X]: [specific issue] - [why it matters for planning]

    **Recommendations (advisory, do not block approval):**
    - [suggestions for improvement]
```
