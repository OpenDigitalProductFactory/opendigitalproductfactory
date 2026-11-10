---
status: active
---

# Obsidian-compatible vault export (BI-5412E422)

Scope manifest for BI-5412E422. The design is §8 of the
[knowledge linking design](2026-10-14-knowledge-linking-design.md). Scope
rules R1, R2 and R6 apply in full. Depends on BI-957915CB (enforced document
permissions); simpler after BI-67F04B3F.

## Objectives and acceptance

**OBJ-KLX-1:** A person can export one scope of their knowledge from DPF as plain markdown that Obsidian opens without plugins.

**OBJ-KLX-2:** Export never bypasses scope or access control, and every export is audited.

| Acceptance | Objectives | Statement |
|------------|------------|-----------|
| AC-KLX-1 | OBJ-KLX-1 | The exported folder opens in Obsidian with working links, backlinks and properties, without plugins. |
| AC-KLX-2 | OBJ-KLX-1 | A parse test reads every exported file back, and its frontmatter matches the typed fields exactly. |
| AC-KLX-3 | OBJ-KLX-2 | A person starts each export from the portal, and needs the `knowledge_export` capability, which no other grant implies. No MCP export tool exists. Each run covers exactly one scope. |
| AC-KLX-4 | OBJ-KLX-2 | A restricted document the caller cannot read is left out of the zip. Links to anything outside the export become plain text. |
| AC-KLX-5 | OBJ-KLX-2 | Before the download starts, each export writes a compliance audit record holding the principal id, scope, counts and the zip's SHA-256. If the principal cannot be identified, the export is refused. |
