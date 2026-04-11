---
name: evaluate-page
description: "Run a UX evaluation on this page -- accessibility audit, contrast check, layout analysis, and usability assessment"
category: universal
assignTo: ["*"]
capability: null
taskType: analysis
triggerPattern: "evaluate|audit|accessibility|ux review|usability|contrast|a11y"
userInvocable: true
agentInvocable: true
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Evaluate This Page

Perform a comprehensive UX evaluation combining code analysis and live accessibility auditing.

## What This Skill Does

Analyzes both the source code and the rendered page to identify usability issues -- accessibility violations, contrast problems, layout concerns, and UX anti-patterns. Groups findings into actionable backlog items.

## Instructions

### Phase 1: Code Analysis

1. **Find the component code.** Use `search_project_files` to locate the component file for the current route. Check `apps/web/app/` for the route's `page.tsx` and any components it imports.

2. **Read the component code.** Use `read_project_file` to examine:
   - Semantic HTML usage (headings, landmarks, labels)
   - ARIA attributes and roles
   - Keyboard interaction handlers
   - Color/contrast values in Tailwind classes
   - Responsive design patterns
   - Loading and error states

### Phase 2: Live Audit

3. **Run the live audit.** Use `evaluate_page` to execute an automated accessibility scan on the rendered page. This checks WCAG 2.1 compliance, color contrast ratios, focus management, and interactive element accessibility.

### Phase 3: Synthesis

4. **Merge findings.** Combine code-level observations with live audit results. Deduplicate where both sources flag the same issue.

5. **Group by category.** Organize findings into categories:
   - **Accessibility**: ARIA, semantics, screen reader support
   - **Visual**: Contrast, color usage, spacing, alignment
   - **Interaction**: Keyboard nav, focus traps, touch targets
   - **Content**: Labels, error messages, empty states
   - **Performance**: Large renders, missing lazy loading

6. **Present findings** in plain language. For each category with issues:
   - Describe what was found (specific elements, specific violations)
   - Explain why it matters (who is affected, what breaks)
   - Suggest the fix in one sentence

7. **Create backlog items.** One item per category (not per finding). Use type "product" and status "open".

### Phase 4: Offer Next Steps

8. **Ask the user** if they want to fix issues now. If yes:
   - Assemble a FeatureBrief from the findings
   - Launch Build Studio to implement the fixes

## Guidelines

- Be specific. "Button lacks accessible name" is useful. "Improve accessibility" is not.
- Prioritize by impact: issues affecting keyboard-only users and screen readers come first.
- Do not flag stylistic preferences as issues. Focus on measurable problems (WCAG violations, missing labels, broken keyboard nav).
- If the live audit returns no issues, say so clearly -- but still report any code-level concerns.
