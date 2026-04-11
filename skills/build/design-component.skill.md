---
name: design-component
description: "Design a new UI component using DPF design system tokens"
category: build
assignTo: ["build-specialist"]
capability: "view_platform"
taskType: "code_generation"
triggerPattern: "design|component|ui element"
userInvocable: true
agentInvocable: true
allowedTools: [read_project_file, search_project_files, propose_file_change]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Design a UI Component

I want to design a new UI component. Before writing code: ask me what the component does, what states it needs, and where it fits in the layout. Then generate using DPF design system tokens.

## Steps

1. Ask the user: What does this component do? What is its primary purpose?
2. Ask about states: default, loading, empty, error, disabled.
3. Ask where it fits: which page, what layout context, responsive needs.
4. Use `search_project_files` to find similar existing components for consistency.
5. Use `read_project_file` to check the design system tokens and patterns in use.
6. Generate the component code following DPF conventions.
7. Use `propose_file_change` to present the code for review.

## Guidelines

- Always check existing components before creating new ones — avoid duplication.
- Use the project's design system tokens (colors, spacing, typography).
- Follow the existing component patterns: naming, file structure, export style.
- Include TypeScript types for all props.
- Generate accessible markup (ARIA labels, keyboard navigation).
- Keep components focused — one responsibility per component.
