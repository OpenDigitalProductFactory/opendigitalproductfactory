---
name: build-page
description: "Scaffold a Next.js App Router page inside DPF after the target route, data, actions, and navigation context are known; use for page implementation, not feature intake."
category: build
assignTo: ["build-specialist"]
capability: "view_platform"
taskType: "code_generation"
triggerPattern: "build page|scaffold page|new page|add route|create screen|page implementation"
userInvocable: true
agentInvocable: false
allowedTools: [read_project_file, search_project_files, propose_file_change]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Build a New Page

Scaffold a real DPF page that follows the existing route, layout, navigation, data-loading, and theme-token conventions. The first screen should be the actual usable surface, not a placeholder or marketing-style landing page.

Do not use this for early feature discovery; use `start-feature` instead. Do not use this for a standalone component inside an existing page; use `design-component` instead.

## Read First

| Source | Path | What to extract |
| --- | --- | --- |
| Route tree | apps/web/app | Nearest page, layout, loading, and error-boundary patterns |
| Components | apps/web/components | Existing surface, table, form, tab, and panel conventions |
| Design rules | AGENTS.md and docs/platform-usability-standards.md | Theme-token, accessibility, and UX verification requirements |
| Page context | PAGE DATA | Target route, visible data, and current workflow state |

## Steps

1. Ask for missing route, data, or action details only when they are not already clear from the user request.
2. Search the route tree for the nearest matching page and navigation pattern.
3. Read the parent layout and at least one similar page before writing code.
4. Generate the `page.tsx` and any required loading or client component files using existing DPF patterns.
5. Use DPF CSS variables for every color and semantic HTML landmarks for structure.
6. Include loading, empty, error, and permission-aware states when the route can reach them.
7. Propose the file changes and name the verification path that should be exercised in the running app.

## Output Template

- Route: `<target route>`
- Data: `<records or actions displayed>`
- Files: `<files to create or update>`
- UX states: `<loading, empty, error, populated, restricted>`
- Verification: `<unit/typecheck/build plus browser path>`

## Guidelines

- Prefer server components for data loading and client components only for interaction.
- Do not hardcode colors, gray Tailwind classes, or inline hex values.
- Keep page sections unframed unless the existing surface uses cards for repeated items or tools.
- Keep the scaffold compile-ready and navigable, even when deeper data integrations come later.

## Example

Input: "Add a page for reviewing skill audit results."

Output: A routed page under the appropriate `/platform/ai` area, reading existing platform navigation patterns, showing audit summary, worst skills, empty state, and a clear verification path.
