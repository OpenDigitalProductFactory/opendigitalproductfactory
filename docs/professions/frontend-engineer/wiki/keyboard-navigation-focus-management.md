---
title: Keyboard navigation and focus management
pageKind: principle
status: published
abstract: All interactive controls must be reachable, operable, and visibly focusable using the keyboard alone. Keyboard access is a minimum accessibility requirement; adopting an ARIA widget role obligates its keyboard contract.
principleTier: core
principleDirection: Make every interactive control fully operable and visibly focusable by keyboard; implement the keyboard contract for any custom widget.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"governance_compliance": 0.8, "human_cognitive_load": 0.5}
professionCompetencyLevel: practitioner
sources:
  - w3c/wcag22
  - mdn/accessibility
  - w3c/aria-apg
---

## Rule

Every interactive control must be **reachable, operable, and visibly focusable using the keyboard alone** — no action may require a pointer. Focus order must be logical and focus must never be trapped.

## Why

WCAG's **Operable** principle requires that UI components and navigation work without a mouse, and MDN states keyboard accessibility "is part of the minimum accessibility requirements" for interactive widgets. Keyboard-only users, screen-reader users, and many motor-impaired users depend on it. When you build a custom widget with an ARIA role, the WAI APG makes clear you have promised its **keyboard interactions** — arrow-key navigation, Enter/Space activation, Escape, and correct focus movement.

## How To Apply

1. **Tab to everything interactive.** Every control is in the tab order (or programmatically focusable when appropriate); nothing interactive is mouse-only.
2. **Visible focus.** Never remove focus outlines without an equivalent visible indicator.
3. **Honor the widget contract.** A custom component's role implies specific keys — implement them per [[professions/frontend-engineer/first-rule-of-aria-native-elements]] (or use a native element that provides them free).
4. **No focus traps.** Users can always move focus out of a component (modals manage focus deliberately).

## See Also

- [[professions/frontend-engineer/first-rule-of-aria-native-elements]]
- [[professions/frontend-engineer/wcag-four-principles-aa-conformance]]
