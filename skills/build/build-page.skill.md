---
name: build-page
description: "Scaffold a new page with data, actions, and routing"
category: build
assignTo: ["build-specialist"]
capability: "view_platform"
taskType: "code_generation"
triggerPattern: "build page|scaffold|new page"
userInvocable: true
agentInvocable: true
allowedTools: [read_project_file, search_project_files, propose_file_change]
composesFrom: []
contextRequirements: []
riskBand: low
---

# Build a New Page

I want to build a new page. Ask me: what data does it display, what actions can users take, and which route should it live under.

## Steps

1. Ask the user: What data does this page display?
2. Ask: What actions can users take on this page?
3. Ask: Which route should it live under? (e.g., `/admin/settings`, `/portfolio/[id]`)
4. Use `search_project_files` to find the existing route structure and page patterns.
5. Use `read_project_file` to review the layout and navigation for the target route.
6. Generate the page following Next.js App Router conventions (page.tsx, layout if needed).
7. Use `propose_file_change` to present the scaffolded page.

## Guidelines

- Follow Next.js 16 App Router conventions: `page.tsx`, `layout.tsx`, `loading.tsx`.
- Use server components by default; add `"use client"` only when interactivity requires it.
- Include proper TypeScript types for all data and props.
- Wire up navigation in the parent layout or nav component.
- Generate a loading state skeleton for the page.
- Keep the initial scaffold minimal — it should compile and render immediately.
