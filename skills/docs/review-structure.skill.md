---
name: review-structure
description: "Review the structure of a document for quality and consistency"
category: docs
assignTo: ["documentation-specialist"]
capability: null
taskType: "analysis"
triggerPattern: "review|structure|heading|cross.reference"
userInvocable: true
agentInvocable: true
allowedTools: [read_project_file, search_project_files]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Review Document Structure

Review the structure of this document.

## Steps

1. Identify the document to review from PAGE DATA or ask the user.
2. Use `read_project_file` to read the document content.
3. Analyse the structure: heading hierarchy, section organisation, logical flow.
4. Check for: missing sections, orphaned headings, inconsistent heading levels.
5. Verify cross-references and links if present.
6. Use `search_project_files` to check for related documents that should be cross-linked.
7. Present findings with specific recommendations.

## Guidelines

- Check heading hierarchy: H1 > H2 > H3, no skipped levels.
- Look for sections that are too long (>500 words without a subheading).
- Flag any dead links or broken cross-references.
- Suggest where diagrams or tables would improve comprehension.
- Keep feedback constructive and actionable — not just "this is wrong."
