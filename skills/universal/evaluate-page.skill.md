---
name: evaluate-page
description: "Evaluate the current page for accessibility, theme-token use, layout stability, and usability issues using code inspection plus live audit evidence when tools are available."
category: universal
assignTo: ["*"]
capability: null
taskType: analysis
triggerPattern: "evaluate page|audit page|accessibility audit|ux review|usability review|contrast|a11y"
userInvocable: true
agentInvocable: false
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Evaluate This Page

Combine source inspection and rendered-page evidence to identify concrete usability defects. Findings must be measurable and tied to DPF's theme-aware UI rules, not personal design preference.

Do not use this for general page summaries; use `analyze-page` instead. Do not use this to implement fixes; create a follow-up brief or backlog item instead.

## Read First

| Source | Path | What to extract |
| --- | --- | --- |
| Route source | apps/web/app | Page, layout, loading, error, and imported component files |
| Component source | apps/web/components | Markup, state handling, tokens, labels, and interaction patterns |
| Live page | rendered route via `evaluate_page` | Accessibility, contrast, focus, and layout issues |
| UI rules | AGENTS.md and docs/platform-usability-standards.md | DPF theme-token and verification requirements |

## Steps

1. Find the component code for the current route.
2. Read the page and imported components before judging behavior.
3. Run the live audit with `evaluate_page` **once**, only when the browser-use sidecar is expected to be up:
   - Pass an **absolute** URL reachable from the sidecar network (service hostname inside Docker; not host-only `localhost` from a Windows/macOS agent).
   - If the tool returns `success=false` with DEGRADED, NOT-RUN, `browser_use_unavailable`, `missing_url`, or `retryable: false` — **stop**. Do not retry the same args (BI-MCP-EFF-71D7229F: blind retries were ~97% of failures).
   - Fall back to code-only review and state clearly that live audit did not run.
4. Merge code-level and live findings, deduplicating repeated issues.
5. Prioritize accessibility, keyboard, contrast, layout stability, labels, and empty/error states.
6. Create backlog items by category only when findings are real and actionable.
7. Return blockers first, then lower-risk improvements.

## Output Template

- Accessibility: `<issues or none found>`
- Visual/theme: `<hardcoded colors, contrast, spacing, layout stability>`
- Interaction: `<keyboard, focus, touch target, loading state>`
- Content/state: `<labels, empty, error, or helper text>`
- Backlog created: `<item titles or none>`
- Fix path: `<smallest implementation slice>`

## Guidelines

- Do not flag stylistic preferences as defects.
- Do not claim live audit coverage if the tool was unavailable.
- Never loop `evaluate_page` on identical inputs after a failure — fix URL/sidecar or continue without live evidence.
- Use exact file paths or visible elements when possible.
- Group many similar issues into one backlog item per category.

## Example

Input: "Evaluate this page."

Output: "Accessibility: the icon-only save button lacks an accessible name in `SettingsToolbar`. Visual/theme: the panel uses `text-gray-500` instead of `var(--dpf-muted)`. Backlog created: `Fix settings toolbar accessibility and theme tokens`."
