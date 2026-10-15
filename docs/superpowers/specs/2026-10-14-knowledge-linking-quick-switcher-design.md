---
status: active
---

# Ctrl+K quick switcher (BI-359C7C2F)

Scope manifest for BI-359C7C2F. The design is §3.5 and §9 of the
[knowledge linking design](2026-10-14-knowledge-linking-design.md). Scope
rules R1, R2 and R5 apply. This ships after BI-MCP-EFF-4F823E5B.

## Objectives and acceptance

**OBJ-KLQ-1:** From anywhere in the portal, the reader can reach any entity they can open with one shortcut and a few characters.

**OBJ-KLQ-2:** The switcher never reveals an entity the reader cannot open.

| Acceptance | Objectives | Statement |
|------------|------------|-----------|
| AC-KLQ-1 | OBJ-KLQ-1 | Ctrl+K or Cmd+K opens the switcher from any shell page. Typing an exact `BI-`, `EP-`, `DOC-`, `KA-` or `WC-` id and pressing Enter once opens that entity. |
| AC-KLQ-2 | OBJ-KLQ-1 | Title search across backlog items, epics, wiki pages, documents and Workrooms returns within 300 ms at the 95th percentile on the dev install. The dialog works entirely from the keyboard, follows the theme, and has a recorded UX-fit review. |
| AC-KLQ-3 | OBJ-KLQ-2 | An existing id the reader cannot open shows the same "No match" message as an id that does not exist. Search results include only entities that pass `canReadEntity`. |
| AC-KLQ-4 | OBJ-KLQ-2 | The browser's recent list stores only ids, and the server re-checks it each time the dialog opens. |
