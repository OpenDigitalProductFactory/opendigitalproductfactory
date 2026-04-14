---
name: ui-ux-design-intelligence
description: "UI/UX design intelligence for building professional interfaces. 67 styles, 96 color palettes, 57 font pairings, 25 chart types, 99 UX guidelines. Covers accessibility, layout, animation, typography, and style selection by product type and industry."
category: design
assignTo: ["build-specialist"]
capability: "view_platform"
taskType: "code_generation"
triggerPattern: "design|ui|ux|style|color palette|typography|font|layout|accessibility|landing page|dashboard|component"
userInvocable: true
agentInvocable: true
allowedTools: [read_project_file, search_project_files, propose_file_change, check_sandbox]
composesFrom: []
contextRequirements: []
riskBand: low
---

# UI/UX Design Intelligence

Comprehensive design guide for web and mobile applications. Contains 67 styles, 96 color palettes, 57 font pairings, 99 UX guidelines, and 25 chart types across 13 technology stacks.

## When to Apply

Reference these guidelines when:
- Designing new UI components or pages
- Choosing color palettes and typography
- Reviewing code for UX issues
- Building landing pages or dashboards
- Implementing accessibility requirements

## Rule Categories by Priority

| Priority | Category | Impact | Domain |
|----------|----------|--------|--------|
| 1 | Accessibility | CRITICAL | `ux` |
| 2 | Touch & Interaction | CRITICAL | `ux` |
| 3 | Performance | HIGH | `ux` |
| 4 | Layout & Responsive | HIGH | `ux` |
| 5 | Typography & Color | MEDIUM | `typography`, `color` |
| 6 | Animation | MEDIUM | `ux` |
| 7 | Style Selection | MEDIUM | `style`, `product` |
| 8 | Charts & Data | LOW | `chart` |

## Quick Reference

### 1. Accessibility (CRITICAL)

- `color-contrast` - Minimum 4.5:1 ratio for normal text
- `focus-states` - Visible focus rings on interactive elements
- `alt-text` - Descriptive alt text for meaningful images
- `aria-labels` - aria-label for icon-only buttons
- `keyboard-nav` - Tab order matches visual order
- `form-labels` - Use label with for attribute

### 2. Touch & Interaction (CRITICAL)

- `touch-target-size` - Minimum 44x44px touch targets
- `hover-vs-tap` - Use click/tap for primary interactions
- `loading-buttons` - Disable button during async operations
- `error-feedback` - Clear error messages near problem
- `cursor-pointer` - Add cursor-pointer to clickable elements

### 3. Performance (HIGH)

- `image-optimization` - Use WebP, srcset, lazy loading
- `reduced-motion` - Check prefers-reduced-motion
- `content-jumping` - Reserve space for async content

### 4. Layout & Responsive (HIGH)

- `viewport-meta` - width=device-width initial-scale=1
- `readable-font-size` - Minimum 16px body text on mobile
- `horizontal-scroll` - Ensure content fits viewport width
- `z-index-management` - Define z-index scale (10, 20, 30, 50)

### 5. Typography & Color (MEDIUM)

- `line-height` - Use 1.5-1.75 for body text
- `line-length` - Limit to 65-75 characters per line
- `font-pairing` - Match heading/body font personalities

### 6. Animation (MEDIUM)

- `duration-timing` - Use 150-300ms for micro-interactions
- `transform-performance` - Use transform/opacity, not width/height
- `loading-states` - Skeleton screens or spinners

### 7. Style Selection (MEDIUM)

- `style-match` - Match style to product type
- `consistency` - Use same style across all pages

### 8. Charts & Data (LOW)

- `chart-type` - Match chart type to data type
- `color-guidance` - Use accessible color palettes
- `data-table` - Provide table alternative for accessibility

## Common Rules for Professional UI

### Icons & Visual Elements

| Rule | Do | Don't |
|------|----|----- |
| Stable hover states | Use color/opacity transitions on hover | Use scale transforms that shift layout |
| Consistent icon sizing | Use fixed viewBox (24x24) with w-6 h-6 | Mix different icon sizes randomly |

### Interaction & Cursor

| Rule | Do | Don't |
|------|----|----- |
| Cursor pointer | Add cursor-pointer to all clickable/hoverable cards | Leave default cursor on interactive elements |
| Hover feedback | Provide visual feedback (color, shadow, border) | No indication element is interactive |
| Smooth transitions | Use transition-colors duration-200 | Instant state changes or too slow (>500ms) |

### Light/Dark Mode Contrast

| Rule | Do | Don't |
|------|----|----- |
| Text contrast light | Use dark values (slate-900) for text | Use muted values (slate-400) for body text |
| Border visibility | Use visible borders in both modes | Use near-invisible borders |

### Layout & Spacing

| Rule | Do | Don't |
|------|----|----- |
| Content padding | Account for fixed navbar height | Let content hide behind fixed elements |
| Consistent max-width | Use same max-width container | Mix different container widths |

## Pre-Delivery Checklist

### Visual Quality
- [ ] All icons from consistent icon set
- [ ] Hover states don't cause layout shift
- [ ] Colors use semantic design tokens

### Interaction
- [ ] All clickable elements have cursor-pointer
- [ ] Hover states provide clear visual feedback
- [ ] Transitions are smooth (150-300ms)
- [ ] Focus states visible for keyboard navigation

### Light/Dark Mode
- [ ] Light mode text has sufficient contrast (4.5:1 minimum)
- [ ] Borders visible in both modes
- [ ] Test both modes before delivery

### Layout
- [ ] No content hidden behind fixed navbars
- [ ] Responsive at 375px, 768px, 1024px, 1440px
- [ ] No horizontal scroll on mobile

### Accessibility
- [ ] All images have alt text
- [ ] Form inputs have labels
- [ ] Color is not the only indicator
- [ ] prefers-reduced-motion respected
