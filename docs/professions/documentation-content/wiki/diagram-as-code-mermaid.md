---
title: Diagram as code with Mermaid
pageKind: heuristic
status: published
abstract: Author diagrams as version-controllable text with Mermaid rather than in GUI tools, so diagrams live beside the docs and update with the source. Choose the diagram type to match the message.
professionCompetencyLevel: practitioner
sources:
  - mermaid/intro
---

## Heuristic

Author diagrams **as code**. Mermaid is "a JavaScript based diagramming and charting tool that renders Markdown-inspired text definitions" — so a diagram is plain text that lives in the repository next to the documentation and updates with the source.

## Why Diagram-as-Code

- **Version-controlled.** Diffs, reviews, and history apply to diagrams like any other source.
- **Co-located.** The diagram lives beside the doc it illustrates and cannot drift into a stale exported image.
- **No GUI round-trip.** Edits are text edits, reviewable in a PR.

## Pick the Type to the Message

Mermaid supports a broad set — flowchart, sequence, class, state, ER, Gantt, C4, mindmap, timeline. Match the type to what you are communicating:

- **Flowchart** — a process or decision flow.
- **Sequence** — interactions/messages over time.
- **ER** — data model relationships.
- **Class / state** — structure and lifecycle.

## How DPF Coworkers Use It

- Default to Mermaid for architecture and flow diagrams in docs; reserve images for what text cannot express.
- Keep diagrams in the right Diataxis page — see [[professions/documentation-content/documentation-set-structure-ia]].
- Apply [[professions/documentation-content/write-for-the-reader-clarity]] to labels.

## See Also

- [[professions/documentation-content/documentation-set-structure-ia]]
- [[professions/documentation-content/write-for-the-reader-clarity]]
