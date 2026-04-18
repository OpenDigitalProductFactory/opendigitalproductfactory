---
name: portal-navigation-audit
description: Audit and improve portal navigation, route organization, and page hierarchy for complex web apps. Use when evaluating top nav, sub nav, workspace chrome, page grouping, information architecture, menu overlap, or when planning a scalable navigation model for future growth.
---

# Portal Navigation Audit

## Purpose

Use this skill to review and improve how a complex portal is organized and navigated. The goal is to reduce overlap between navigation layers, make the system easier to learn, and give future features a predictable place to live.

## When to use

- The user asks to evaluate navigation across many pages or sections
- Top navigation, sub navigation, sidebars, tabs, and workspace-level controls feel duplicated or confusing
- A portal is growing and needs a clearer information architecture
- New sections are being added and it is no longer obvious where they belong

## Core principles

1. Each navigation layer must have one job only.
2. Global navigation should answer "where am I in the product?"
3. Section navigation should answer "which area of this domain am I in?"
4. In-page workspace controls should answer "what can I do on this screen right now?"
5. Avoid showing the same choice in multiple layers unless one is clearly a shortcut.
6. Prefer stable section homes over one-off entry points.
7. Group by user mental model and jobs to be done, not by implementation detail.

## Navigation model

Use this hierarchy when reviewing or redesigning the portal:

1. Global nav
   - Persistent product-level areas
   - Small number of durable destinations
   - Examples: Workspace, Operations, AI Workforce, Admin

2. Section nav
   - Tabs or sub-routes within one product area
   - Shows sibling views inside the chosen area
   - Must not repeat global destinations

3. Local page nav
   - Anchors, secondary tabs, filters, or panel toggles inside a page
   - Only for page-specific tasks and content views

4. Contextual actions
   - Buttons, create menus, quick actions
   - These are actions, not navigation

## Audit checklist

Review each page and route for:

- Entry point: how users discover the page
- Parent section: where the page belongs
- Sibling pages: what users compare it with
- Current nav layers shown at once
- Overlap or duplication between header, tabs, sidebar, and workspace controls
- Whether the page is destination content, configuration, workflow step, or detail view
- Whether the page should be promoted, demoted, merged, or hidden behind a task flow

## Smells

Treat these as likely problems:

- Top nav and sub nav list the same destinations
- The workspace chrome competes visually with route navigation
- Pages mix "where to go" controls with "what to do" controls
- A section has too many peers in one horizontal tab row
- Settings/configuration pages are mixed with operational workflows
- A detail page is reachable from global navigation
- Pages exist because the schema exists, not because users need a destination

## Recommended output

Produce:

1. Current-state map
   - Global areas
   - Section-level tabs/sub-routes
   - Pages that do not fit cleanly

2. Problems by severity
   - Overlap
   - Naming issues
   - Structural issues
   - Scalability risks

3. Target-state model
   - Proposed global nav
   - Proposed section groupings
   - Rules for when to use tabs, sidebars, breadcrumbs, drawers, and workspace panels

4. Migration guidance
   - Quick wins
   - Medium refactors
   - Long-horizon IA changes

## Portal-specific guidance

When working in this repository:

- Follow AGENTS.md section-organization guidance: use tab nav with sub-routes for sections that span multiple concerns
- Preserve theme-aware styling using the platform CSS variables
- Keep server components responsible for data fetch, with client wrappers for interactivity
- Prefer progressive disclosure over exposing every configuration surface in top-level navigation
- Keep setup flows wizard-first and recurring edits lightweight

## Decision rules

- Use top nav for durable domains only
- Use section tabs for sibling areas within one domain
- Use breadcrumbs for drill-down depth, not for sibling switching
- Use workspace side panels for task context, assistants, inspectors, or temporary tools
- Use command bars or quick actions for cross-cutting actions, not as a substitute for IA

## What good looks like

The audit is complete when:

- Every major page has an obvious home
- Navigation layers no longer duplicate each other
- Users can predict where future features will be added
- The portal can grow without adding another competing menu bar
