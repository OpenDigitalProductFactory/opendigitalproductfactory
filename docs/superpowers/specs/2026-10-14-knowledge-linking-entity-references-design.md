---
status: active
---

# Universal entity references (BI-A63A9476)

Scope manifest for BI-A63A9476. The design is in §3 and §5 of the
[knowledge linking design](2026-10-14-knowledge-linking-design.md). Scope
rules R1–R7 in its §2 apply in full.

## Objectives and acceptance

**OBJ-KLR-1:** When an entity id or wiki link is written in any body, it renders as a link and produces a derived reference edge in the existing graph mirror.

**OBJ-KLR-2:** Every backlog item, epic, document and wiki page shows what references it, limited to what the reader may open.

**OBJ-KLR-3:** References respect the WWMD, WWWD and WSID scope boundaries and the reader's access, for people and agents alike.

| Acceptance | Objectives | Statement |
|------------|------------|-----------|
| AC-KLR-1 | OBJ-KLR-1 | In backlog, epic, document, Workroom message and wiki bodies, a known id the reader can open renders as a link. An unknown id and an id the reader cannot open both render the same way, as plain text. |
| AC-KLR-2 | OBJ-KLR-1 | Saving a body creates and removes `REFERENCES` edges in `graph_edge` idempotently. Re-running `references:rebuild` changes nothing. No new table is added; the substrate check is recorded in §3.1 of the design. |
| AC-KLR-3 | OBJ-KLR-2 | The backlog item panel, the epic card, the document page and the wiki panel each show "Referenced by" with source, kind, scope and snippet. `get_backlog_item` returns the same `referencedBy` list to agents. |
| AC-KLR-4 | OBJ-KLR-3 | The writer refuses edges from kernel or profession pages to WWWD records, and lint reports any such edge. |
| AC-KLR-5 | OBJ-KLR-3 | A contract test shows that a reference from a source the reader cannot open is missing from every read surface, counts included. The test covers another organization, restricted backlog sensitivity, a room the reader is not admitted to, and a corpus outside the agent's grants. |
| AC-KLR-6 | OBJ-KLR-3 | `wiki_kernel_read`, `wiki_org_read` and `wiki_profession_read` exist, and `registry_read` implies all three. A coworker holding only one of them sees references only within that corpus. |
