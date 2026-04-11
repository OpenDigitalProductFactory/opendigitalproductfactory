---
name: generate-diagram
description: "Generate a Mermaid diagram for a described concept"
category: docs
assignTo: ["docs-specialist"]
capability: null
taskType: "code_generation"
triggerPattern: "diagram|mermaid|flowchart|sequence"
userInvocable: true
agentInvocable: true
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Generate a Mermaid Diagram

Generate a Mermaid diagram for the concept I describe.

## Steps

1. Ask the user what they want to diagram: process flow, sequence, architecture, state machine, etc.
2. Determine the best Mermaid diagram type: flowchart, sequenceDiagram, classDiagram, stateDiagram, erDiagram, gantt.
3. Ask for the key elements and relationships.
4. Generate valid Mermaid syntax.
5. Present the diagram code in a fenced code block with the `mermaid` language tag.
6. Offer to refine based on feedback.

## Guidelines

- Always validate that the Mermaid syntax is correct before presenting.
- Keep diagrams readable — no more than 15-20 nodes for flowcharts.
- Use clear, descriptive labels on nodes and edges.
- Choose the diagram type that best fits the concept — do not force everything into a flowchart.
- If the concept is too complex for one diagram, suggest splitting into multiple views.
