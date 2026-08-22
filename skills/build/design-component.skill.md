---
name: design-component
description: "Design or refactor a DPF UI component with accessible states, theme-aware styling, and existing component patterns; use for component work, not whole-page scaffolding."
category: build
assignTo: ["build-specialist"]
capability: "view_platform"
taskType: "code_generation"
triggerPattern: "design component|ui component|component states|refactor component|new control|interface element"
userInvocable: true
agentInvocable: false
allowedTools: [read_project_file, search_project_files, propose_file_change]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Design a UI Component

Create or refactor a focused UI component that matches DPF's product surfaces: quiet, usable, accessible, and theme-aware. Every component must work in light mode, dark mode, and branded installations.

Do not use this for a full route or page; use `build-page` instead. Do not use this for feature intake; use `start-feature` instead.

## Read First

| Source | Path | What to extract |
| --- | --- | --- |
| Similar components | apps/web/components | Naming, props, layout density, states, and interaction patterns |
| Target route | apps/web/app | Where the component sits and what parent layout constrains it |
| Design standard | AGENTS.md and docs/platform-usability-standards.md | Theme-token, accessibility, focus, and responsive requirements |
| PAGE DATA | current agent context | User intent, active workflow, and visible state |

## Steps

1. Read at least one similar existing component before proposing a new shape.
2. Ask one clarifying question only if the component purpose or required states are unclear.
3. Define props and states before writing JSX.
4. Generate semantic markup with keyboard and screen-reader support.
5. Use `var(--dpf-*)` tokens for all colors and avoid hardcoded visual constants that fight branding.
6. Keep layout dimensions stable so hover, labels, and dynamic content do not shift surrounding UI.
7. Return the component code plus the specific verification path.

## Output Template

- Component: `<name>`
- Purpose: `<single responsibility>`
- Props: `<key props and data shape>`
- States: `<default, loading, empty, error, disabled, selected as applicable>`
- Files: `<files to update>`
- Verification: `<tests/typecheck/build and UI path>`

## Guidelines

- Use existing icons and controls before inventing new visual language.
- Keep text inside buttons and compact panels sized to the container.
- Prefer small dedicated subcomponents over a large conditional body.
- Do not put cards inside cards or use decorative gradients/orbs.

## Example

Input: "Make a compact skill score row."

Output: A focused component with score, severity, finding count, keyboard-safe action button, theme-token styling, and stable width behavior in narrow panels.
